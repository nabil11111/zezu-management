import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { getEnv } from "@/lib/env";

/**
 * Server-only auth internals. This module must NEVER be statically imported
 * from a file that's also loaded by client-rendered routes — it imports
 * `node:crypto`, and Vite's client build cannot resolve Node-only named
 * exports. Always reach it via a dynamic import from *inside* a
 * `createServerFn(...).handler(...)` callback:
 *
 *   .handler(async ({ data }) => {
 *     const { requireAuth } = await import("@/lib/auth.server");
 *     const actor = await requireAuth();
 *     ...
 *   })
 *
 * ZEZU access model — no usernames, no passwords. Everyone signs in with
 * their own unique 4-digit code (stored as HMAC-SHA256, never plaintext).
 * Roles: 'ceo' (everything, every location), 'manager' (their assigned
 * locations only), 'staff' (clock in/out, own shifts, menu & training).
 */

const SESSION_COOKIE = "zezu_session";
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
const THIRTY_DAYS_MS = THIRTY_DAYS_SECONDS * 1000;

export type MemberRole = "ceo" | "manager" | "staff" | "warehouse";

/** The signed-in identity, resolved from the session cookie. */
export interface Actor {
  memberId: string;
  name: string;
  role: MemberRole;
}

interface SessionPayload {
  exp: number;
  mid: string;
  mname: string;
  mrole: MemberRole;
}

/** URL-safe random token — used for location QR tokens. */
export function generateToken(byteLength = 18): string {
  return randomBytes(byteLength).toString("base64url");
}

/** HMAC-SHA256(code) keyed with SESSION_SECRET, base64url. */
export function hashCode(code: string): string {
  const env = getEnv();
  return createHmac("sha256", env.SESSION_SECRET).update(code).digest("base64url");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function createSessionCookieValue(secret: string, actor: Actor): string {
  const payload: SessionPayload = {
    exp: Date.now() + THIRTY_DAYS_MS,
    mid: actor.memberId,
    mname: actor.name,
    mrole: actor.role,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

function verifySessionCookieValue(value: string, secret: string): SessionPayload | null {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expectedSig = sign(payload, secret);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (typeof parsed.exp !== "number" || parsed.exp <= Date.now()) return null;
    if (!parsed.mid || !parsed.mname || !parsed.mrole) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Sets the signed, httpOnly session cookie (30-day expiry). */
export function createSession(actor: Actor): void {
  const env = getEnv();
  setCookie(SESSION_COOKIE, createSessionCookieValue(env.SESSION_SECRET, actor), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS_SECONDS,
  });
}

export function clearSession(): void {
  deleteCookie(SESSION_COOKIE, { path: "/" });
}

/** Reads + verifies the session cookie. Null if absent/invalid/expired. */
export function getSessionActor(): Actor | null {
  const env = getEnv();
  const cookie = getCookie(SESSION_COOKIE);
  if (!cookie) return null;

  const parsed = verifySessionCookieValue(cookie, env.SESSION_SECRET);
  if (!parsed) return null;

  return { memberId: parsed.mid, name: parsed.mname, role: parsed.mrole };
}

/**
 * A cookie stays cryptographically valid for 30 days, so deactivating a
 * member must be enforced here or their access would silently survive.
 */
async function assertMemberStillActive(actor: Actor): Promise<void> {
  const { db, members } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const row = await db.query.members.findFirst({
    where: eq(members.id, actor.memberId),
    columns: { active: true },
  });
  if (!row?.active) {
    throw new Error("Unauthorized");
  }
}

/** Any signed-in, still-active member. Returns the actor. */
export async function requireAuth(): Promise<Actor> {
  const actor = getSessionActor();
  if (!actor) {
    throw new Error("Unauthorized");
  }
  await assertMemberStillActive(actor);
  return actor;
}

/**
 * The location IDs this actor may operate on. CEO → "all". Managers and
 * staff → their member_locations assignments.
 */
export async function getActorLocationIds(actor: Actor): Promise<"all" | string[]> {
  if (actor.role === "ceo") return "all";
  const { db, memberLocations } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select({ locationId: memberLocations.locationId })
    .from(memberLocations)
    .where(eq(memberLocations.memberId, actor.memberId));
  return rows.map((r) => r.locationId);
}

/**
 * CEO or manager. Returns the actor plus the locations they control —
 * use `assertLocationAccess` (or check the list) before writing to one.
 */
export async function requireManager(): Promise<{
  actor: Actor;
  locationIds: "all" | string[];
}> {
  const actor = await requireAuth();
  if (actor.role !== "ceo" && actor.role !== "manager") {
    throw new Error("Managers only");
  }
  return { actor, locationIds: await getActorLocationIds(actor) };
}

/** Warehouse or CEO — sees and dispatches every branch's stock orders. */
export async function requireWarehouse(): Promise<Actor> {
  const actor = await requireAuth();
  if (actor.role !== "ceo" && actor.role !== "warehouse") {
    throw new Error("Warehouse only");
  }
  return actor;
}

/**
 * Any member assigned to the given location (staff included), or the CEO.
 * The stock-order flow uses this: placing and verifying orders is branch
 * work, done by whoever is actually standing in the shop.
 */
export async function requireLocationMember(locationId: string): Promise<Actor> {
  const actor = await requireAuth();
  if (actor.role === "ceo") return actor;
  const locationIds = await getActorLocationIds(actor);
  assertLocationAccess(locationIds, locationId);
  return actor;
}

/** CEO only (locations, team codes, brand settings). */
export async function requireCeo(): Promise<Actor> {
  const actor = await requireAuth();
  if (actor.role !== "ceo") {
    throw new Error("CEO only");
  }
  return actor;
}

/** The capability keys this actor currently holds. CEO → every capability. */
export async function getActorCapabilities(actor: Actor): Promise<string[]> {
  const { MEMBER_CAPABILITIES } = await import("@/server/types");
  if (actor.role === "ceo") return [...MEMBER_CAPABILITIES];
  const { db, members } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const row = await db.query.members.findFirst({
    where: eq(members.id, actor.memberId),
    columns: { permissions: true },
  });
  const perms = row?.permissions;
  return Array.isArray(perms) ? (perms as string[]) : [];
}

/**
 * Gate a shop-floor action on a configured capability (see MEMBER_CAPABILITIES).
 * CEO always passes. Everyone else must have the capability ticked on their
 * profile. Throws "Not allowed" otherwise.
 */
export async function requireCapability(capability: string): Promise<Actor> {
  const actor = await requireAuth();
  if (actor.role === "ceo") return actor;
  const caps = await getActorCapabilities(actor);
  if (!caps.includes(capability)) {
    throw new Error("Not allowed");
  }
  return actor;
}

/** requireCapability + the location must be one the actor is assigned to. */
export async function requireCapabilityAtLocation(
  capability: string,
  locationId: string,
): Promise<Actor> {
  const actor = await requireCapability(capability);
  if (actor.role === "ceo") return actor;
  const locationIds = await getActorLocationIds(actor);
  assertLocationAccess(locationIds, locationId);
  return actor;
}

/**
 * Everything the signed-in shell needs in one round-trip: the actor, their
 * capabilities, the CEO-controlled sales/salary visibility flags, and the
 * first-login welcome-video state. Loaded once in the `_authed` layout and
 * put on route context so nav and pages can read it without re-querying.
 */
export async function getSessionBootstrap(): Promise<{
  actor: Actor;
  capabilities: string[];
  flags: { salesVisible: boolean; salaryVisible: boolean };
  welcome: { videoUrl: string | null; needsToWatch: boolean };
}> {
  const actor = await requireAuth();
  const { db, members, settings } = await import("@/db");
  const { eq, inArray } = await import("drizzle-orm");

  const [memberRow, settingRows] = await Promise.all([
    db.query.members.findFirst({
      where: eq(members.id, actor.memberId),
      columns: { permissions: true, welcomeSeenAt: true },
    }),
    db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, ["sales_visible", "salary_visible", "welcome_video_url"])),
  ]);

  const settingMap = new Map(settingRows.map((r) => [r.key, r.value]));
  const asBool = (v: unknown) => v === true || v === "true";
  const asStr = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

  const { MEMBER_CAPABILITIES } = await import("@/server/types");
  const capabilities =
    actor.role === "ceo"
      ? [...MEMBER_CAPABILITIES]
      : Array.isArray(memberRow?.permissions)
        ? (memberRow!.permissions as string[])
        : [];

  const videoUrl = asStr(settingMap.get("welcome_video_url"));
  // CEO and warehouse skip the crew welcome; everyone else watches once.
  const skipsWelcome = actor.role === "ceo" || actor.role === "warehouse";
  const needsToWatch = !!videoUrl && !skipsWelcome && !memberRow?.welcomeSeenAt;

  return {
    actor,
    capabilities,
    flags: {
      salesVisible: asBool(settingMap.get("sales_visible")),
      salaryVisible: asBool(settingMap.get("salary_visible")),
    },
    welcome: { videoUrl, needsToWatch },
  };
}

/** Throws unless the actor controls the given location. */
export function assertLocationAccess(locationIds: "all" | string[], locationId: string): void {
  if (locationIds !== "all" && !locationIds.includes(locationId)) {
    throw new Error("No access to this location");
  }
}
