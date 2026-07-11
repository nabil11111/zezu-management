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

export type MemberRole = "ceo" | "manager" | "staff";

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

/** CEO only (locations, team codes, brand settings). */
export async function requireCeo(): Promise<Actor> {
  const actor = await requireAuth();
  if (actor.role !== "ceo") {
    throw new Error("CEO only");
  }
  return actor;
}

/** Throws unless the actor controls the given location. */
export function assertLocationAccess(locationIds: "all" | string[], locationId: string): void {
  if (locationIds !== "all" && !locationIds.includes(locationId)) {
    throw new Error("No access to this location");
  }
}
