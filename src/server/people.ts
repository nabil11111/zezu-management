import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { logActivity } from "@/server/activity";
import { memberRoleSchema, todayDateString, shiftHours, type MemberRole } from "@/server/types";

/**
 * PEOPLE — every member of staff across the three sites: role, site(s),
 * contact, pay rate, one unique 4-digit code, and an onboarding checklist
 * for new hires. Salaries trace back to verified shifts (shifts.status =
 * "verified") × hourlyRate — never anything else.
 *
 * Follows the members.ts pattern: only createServerFn + zod + @/server/types
 * are statically imported. db / auth.server / drizzle-orm are reached via
 * dynamic import inside each handler so this module stays client-bundle-safe.
 *
 * Plaintext 4-digit codes are NEVER stored, logged, or retrievable after
 * creation/regeneration — only the caller who just generated one gets it
 * back, once, in the server-fn response.
 */

const DEFAULT_ONBOARDING_STEPS = [
  "Documents in",
  "Menu & training videos watched",
  "Trial shift done",
  "Code handed over",
];

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

// ── small pure date helpers (Europe/London, matches todayDateString) ────────

function londonDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
}

function londonMonthKey(d: Date): string {
  return londonDateString(d).slice(0, 7);
}

/** The current month plus the 5 before it, oldest first, as "YYYY-MM". */
function lastSixMonthKeys(): string[] {
  const [yStr, mStr] = todayDateString().split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const keys: string[] = [];
  for (let i = 5; i >= 0; i--) {
    let mm = m - i;
    let yy = y;
    while (mm <= 0) {
      mm += 12;
      yy -= 1;
    }
    keys.push(`${yy}-${String(mm).padStart(2, "0")}`);
  }
  return keys;
}

function buildMonthlySummary(
  rows: Array<{ clockInAt: Date | string; clockOutAt: Date | string | null; status: string }>,
  hourlyRate: string | null,
): Array<{ month: string; verifiedHours: number; pendingHours: number; pay: number | null }> {
  const monthKeys = lastSixMonthKeys();
  const buckets = new Map<string, { verifiedHours: number; pendingHours: number }>();
  for (const key of monthKeys) buckets.set(key, { verifiedHours: 0, pendingHours: 0 });

  for (const row of rows) {
    if (!row.clockOutAt) continue;
    const key = londonMonthKey(new Date(row.clockOutAt));
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const hrs = shiftHours(row.clockInAt, row.clockOutAt) ?? 0;
    if (row.status === "verified") bucket.verifiedHours += hrs;
    else if (row.status === "pending") bucket.pendingHours += hrs;
  }

  const rate = hourlyRate !== null ? Number(hourlyRate) : null;
  return monthKeys.map((month) => {
    const bucket = buckets.get(month)!;
    const verifiedHours = Math.round(bucket.verifiedHours * 100) / 100;
    const pendingHours = Math.round(bucket.pendingHours * 100) / 100;
    return {
      month,
      verifiedHours,
      pendingHours,
      pay: rate !== null ? Math.round(verifiedHours * rate * 100) / 100 : null,
    };
  });
}

/** Generates a random unique 4-digit code + its hash. Re-rolls on collision. */
async function generateUniqueCode(): Promise<{ code: string; codeHash: string }> {
  const { hashCode } = await import("@/lib/auth.server");
  const { db, members } = await import("@/db");
  const { eq } = await import("drizzle-orm");

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const candidateHash = hashCode(candidate);
    const existing = await db.query.members.findFirst({
      where: eq(members.codeHash, candidateHash),
    });
    if (!existing) return { code: candidate, codeHash: candidateHash };
  }
  throw new Error("Could not generate a unique code — try again");
}

/** True if the actor's locations overlap the member's assigned locations. */
async function actorSharesLocationWithMember(
  locationIds: "all" | string[],
  memberId: string,
): Promise<boolean> {
  if (locationIds === "all") return true;
  if (locationIds.length === 0) return false;
  const { db, memberLocations } = await import("@/db");
  const { eq, and, inArray } = await import("drizzle-orm");
  const row = await db.query.memberLocations.findFirst({
    where: and(
      eq(memberLocations.memberId, memberId),
      inArray(memberLocations.locationId, locationIds),
    ),
  });
  return !!row;
}

// ── reads ─────────────────────────────────────────────────────────────────

/**
 * CEO sees every member. Managers see members who share at least one of
 * their locations, plus themselves.
 */
export const listMembers = createServerFn({ method: "GET" }).handler(async () => {
  const { requireManager } = await import("@/lib/auth.server");
  const { actor, locationIds } = await requireManager();

  const { db, members, memberLocations, shifts } = await import("@/db");
  const { eq, and, inArray } = await import("drizzle-orm");

  let scopedIds: string[] | null = null; // null = no restriction (CEO)
  if (locationIds !== "all") {
    const visibleRows = locationIds.length
      ? await db
          .selectDistinct({ memberId: memberLocations.memberId })
          .from(memberLocations)
          .where(inArray(memberLocations.locationId, locationIds))
      : [];
    const idSet = new Set(visibleRows.map((r) => r.memberId));
    idSet.add(actor.memberId);
    scopedIds = Array.from(idSet);
  }

  const memberRows = await db.query.members.findMany({
    where: scopedIds ? inArray(members.id, scopedIds) : undefined,
    with: {
      memberLocations: { with: { location: true } },
      onboardingSteps: true,
    },
    orderBy: (m, { asc }) => [asc(m.name)],
  });

  if (memberRows.length === 0) return [];

  const currentMonthKey = todayDateString().slice(0, 7);
  const rowIds = memberRows.map((m) => m.id);
  const shiftRows = await db
    .select({
      memberId: shifts.memberId,
      clockInAt: shifts.clockInAt,
      clockOutAt: shifts.clockOutAt,
    })
    .from(shifts)
    .where(and(eq(shifts.status, "verified"), inArray(shifts.memberId, rowIds)));

  const hoursByMember = new Map<string, number>();
  for (const s of shiftRows) {
    if (!s.clockOutAt) continue;
    if (londonMonthKey(new Date(s.clockOutAt)) !== currentMonthKey) continue;
    const hrs = shiftHours(s.clockInAt, s.clockOutAt) ?? 0;
    hoursByMember.set(s.memberId, (hoursByMember.get(s.memberId) ?? 0) + hrs);
  }

  return memberRows.map((m) => ({
    id: m.id,
    name: m.name,
    role: m.role as MemberRole,
    active: m.active,
    hourlyRate: m.hourlyRate,
    phone: m.phone,
    startedAt: m.startedAt,
    locations: m.memberLocations.map((ml) => ({ id: ml.location.id, name: ml.location.name })),
    onboarding: {
      done: m.onboardingSteps.filter((s) => s.done).length,
      total: m.onboardingSteps.length,
    },
    thisMonthVerifiedHours: Math.round((hoursByMember.get(m.id) ?? 0) * 100) / 100,
  }));
});

/** Full profile + onboarding + last 20 shifts + 6-month pay summary. */
export const getMember = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { requireManager } = await import("@/lib/auth.server");
    const { actor, locationIds } = await requireManager();

    const { db, members, shifts } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const member = await db.query.members.findFirst({
      where: eq(members.id, data.id),
      with: {
        memberLocations: { with: { location: true } },
        onboardingSteps: true,
      },
    });
    if (!member) throw new Error("Member not found");

    if (locationIds !== "all") {
      const memberLocIds = member.memberLocations.map((ml) => ml.locationId);
      const sharesLocation = memberLocIds.some((id) => locationIds.includes(id));
      const isSelf = actor.memberId === member.id;
      if (!sharesLocation && !isSelf) {
        throw new Error("No access to this member");
      }
    }

    const onboardingSteps = [...member.onboardingSteps].sort((a, b) => a.sortOrder - b.sortOrder);

    const recentShifts = await db.query.shifts.findMany({
      where: eq(shifts.memberId, data.id),
      with: { location: true },
      orderBy: (s, { desc }) => [desc(s.clockInAt)],
      limit: 20,
    });

    const allShiftsForSummary = await db.query.shifts.findMany({
      where: eq(shifts.memberId, data.id),
      columns: { clockInAt: true, clockOutAt: true, status: true },
    });

    return {
      id: member.id,
      name: member.name,
      role: member.role as MemberRole,
      active: member.active,
      hourlyRate: member.hourlyRate,
      phone: member.phone,
      startedAt: member.startedAt,
      notes: member.notes,
      locations: member.memberLocations.map((ml) => ({
        id: ml.location.id,
        name: ml.location.name,
      })),
      onboardingSteps,
      recentShifts: recentShifts.map((s) => ({
        id: s.id,
        locationName: s.location.name,
        clockInAt: s.clockInAt,
        clockOutAt: s.clockOutAt,
        hours: shiftHours(s.clockInAt, s.clockOutAt),
        status: s.status as "pending" | "verified" | "rejected",
      })),
      monthlySummary: buildMonthlySummary(allShiftsForSummary, member.hourlyRate),
    };
  });

/** CEO-only: active locations, for the site-assignment UI (add/edit member). */
export const listLocationOptions = createServerFn({ method: "GET" }).handler(async () => {
  const { requireCeo } = await import("@/lib/auth.server");
  await requireCeo();

  const { db } = await import("@/db");

  const rows = await db.query.locations.findMany({
    orderBy: (l, { asc }) => [asc(l.sortOrder)],
  });

  return rows.map((l) => ({ id: l.id, name: l.name, active: l.active }));
});

// ── writes ────────────────────────────────────────────────────────────────

const createMemberSchema = z.object({
  name: z.string().min(1),
  role: memberRoleSchema,
  hourlyRate: z.number().nonnegative().max(9999).optional(),
  phone: z.string().min(1).optional(),
  startedAt: dateStringSchema.optional(),
  notes: z.string().optional(),
  locationIds: z.array(z.string().uuid()),
});

/**
 * CEO-only: creates the member, assigns their sites, seeds the default
 * onboarding checklist, and mints a unique 4-digit code. The plaintext code
 * is returned ONCE — it is never stored and can never be read back.
 */
export const createMember = createServerFn({ method: "POST" })
  .validator(createMemberSchema)
  .handler(async ({ data }) => {
    const { requireCeo } = await import("@/lib/auth.server");
    await requireCeo();

    const { db, members, memberLocations, onboardingSteps } = await import("@/db");

    const { code, codeHash } = await generateUniqueCode();

    const [member] = await db
      .insert(members)
      .values({
        name: data.name,
        role: data.role,
        codeHash,
        hourlyRate: data.hourlyRate !== undefined ? String(data.hourlyRate) : null,
        phone: data.phone ?? null,
        startedAt: data.startedAt ?? null,
        notes: data.notes ?? null,
      })
      .returning();

    if (data.locationIds.length > 0) {
      await db
        .insert(memberLocations)
        .values(data.locationIds.map((locationId) => ({ memberId: member.id, locationId })));
    }

    await db
      .insert(onboardingSteps)
      .values(
        DEFAULT_ONBOARDING_STEPS.map((title, i) => ({ memberId: member.id, title, sortOrder: i })),
      );

    await logActivity("member", member.id, "created", {
      name: member.name,
      role: member.role,
      locationIds: data.locationIds,
    });

    return { member: { id: member.id, name: member.name, role: member.role as MemberRole }, code };
  });

const updateMemberSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  role: memberRoleSchema.optional(),
  hourlyRate: z.number().nonnegative().max(9999).nullable().optional(),
  phone: z.string().min(1).nullable().optional(),
  startedAt: dateStringSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
});

/** CEO-only: edits name/role/hourlyRate/phone/startedAt/notes. */
export const updateMember = createServerFn({ method: "POST" })
  .validator(updateMemberSchema)
  .handler(async ({ data }) => {
    const { requireCeo } = await import("@/lib/auth.server");
    await requireCeo();

    const { db, members } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) set.name = data.name;
    if (data.role !== undefined) set.role = data.role;
    if (data.hourlyRate !== undefined) {
      set.hourlyRate = data.hourlyRate === null ? null : String(data.hourlyRate);
    }
    if (data.phone !== undefined) set.phone = data.phone;
    if (data.startedAt !== undefined) set.startedAt = data.startedAt;
    if (data.notes !== undefined) set.notes = data.notes;

    const [row] = await db.update(members).set(set).where(eq(members.id, data.id)).returning();
    if (!row) throw new Error("Member not found");

    await logActivity("member", data.id, "updated", {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.role !== undefined ? { role: data.role } : {}),
      ...(data.hourlyRate !== undefined ? { hourlyRate: data.hourlyRate } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.startedAt !== undefined ? { startedAt: data.startedAt } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    });

    return { id: row.id };
  });

/** CEO-only: replaces a member's site assignments wholesale. */
export const setMemberLocations = createServerFn({ method: "POST" })
  .validator(z.object({ memberId: z.string().uuid(), locationIds: z.array(z.string().uuid()) }))
  .handler(async ({ data }) => {
    const { requireCeo } = await import("@/lib/auth.server");
    await requireCeo();

    const { db, members, memberLocations } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const member = await db.query.members.findFirst({ where: eq(members.id, data.memberId) });
    if (!member) throw new Error("Member not found");

    await db.delete(memberLocations).where(eq(memberLocations.memberId, data.memberId));
    if (data.locationIds.length > 0) {
      await db
        .insert(memberLocations)
        .values(data.locationIds.map((locationId) => ({ memberId: data.memberId, locationId })));
    }

    await logActivity("member", data.memberId, "locations_updated", {
      locationIds: data.locationIds,
    });
    return { success: true as const };
  });

/**
 * CEO-only: mints a fresh unique code, replacing the old one immediately.
 * Returns the plaintext ONCE. Never logs the code itself.
 */
export const regenerateCode = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { requireCeo } = await import("@/lib/auth.server");
    await requireCeo();

    const { db, members } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const member = await db.query.members.findFirst({ where: eq(members.id, data.id) });
    if (!member) throw new Error("Member not found");

    const { code, codeHash } = await generateUniqueCode();
    await db
      .update(members)
      .set({ codeHash, updatedAt: new Date() })
      .where(eq(members.id, data.id));

    await logActivity("member", data.id, "code_regenerated", { name: member.name });
    return { code };
  });

/** CEO-only: switches a member's access on/off — effective the instant it's set. */
export const setMemberActive = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), active: z.boolean() }))
  .handler(async ({ data }) => {
    const { requireCeo } = await import("@/lib/auth.server");
    await requireCeo();

    const { db, members } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const [row] = await db
      .update(members)
      .set({ active: data.active, updatedAt: new Date() })
      .where(eq(members.id, data.id))
      .returning();
    if (!row) throw new Error("Member not found");

    await logActivity("member", data.id, data.active ? "activated" : "deactivated", {
      name: row.name,
    });
    return { id: row.id, active: row.active };
  });

/** Manager+: flips an onboarding step's done state. Must share a location, or be CEO. */
export const toggleOnboardingStep = createServerFn({ method: "POST" })
  .validator(z.object({ stepId: z.string().uuid(), done: z.boolean() }))
  .handler(async ({ data }) => {
    const { requireManager } = await import("@/lib/auth.server");
    const { locationIds } = await requireManager();

    const { db, onboardingSteps } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const step = await db.query.onboardingSteps.findFirst({
      where: eq(onboardingSteps.id, data.stepId),
    });
    if (!step) throw new Error("Step not found");

    const allowed = await actorSharesLocationWithMember(locationIds, step.memberId);
    if (!allowed) throw new Error("No access to this member");

    const [row] = await db
      .update(onboardingSteps)
      .set({ done: data.done, updatedAt: new Date() })
      .where(eq(onboardingSteps.id, data.stepId))
      .returning();

    await logActivity("member", step.memberId, "onboarding_step_toggled", {
      step: step.title,
      done: data.done,
    });
    return { id: row.id, done: row.done };
  });

/** Manager+: appends a custom onboarding step. Must share a location, or be CEO. */
export const addOnboardingStep = createServerFn({ method: "POST" })
  .validator(z.object({ memberId: z.string().uuid(), title: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { requireManager } = await import("@/lib/auth.server");
    const { locationIds } = await requireManager();

    const allowed = await actorSharesLocationWithMember(locationIds, data.memberId);
    if (!allowed) throw new Error("No access to this member");

    const { db, onboardingSteps } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const existing = await db.query.onboardingSteps.findMany({
      where: eq(onboardingSteps.memberId, data.memberId),
      columns: { id: true },
    });

    const [row] = await db
      .insert(onboardingSteps)
      .values({ memberId: data.memberId, title: data.title, sortOrder: existing.length })
      .returning();

    await logActivity("member", data.memberId, "onboarding_step_added", { step: data.title });
    return row;
  });

/** Manager+: removes an onboarding step. Must share a location, or be CEO. */
export const deleteOnboardingStep = createServerFn({ method: "POST" })
  .validator(z.object({ stepId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { requireManager } = await import("@/lib/auth.server");
    const { locationIds } = await requireManager();

    const { db, onboardingSteps } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const step = await db.query.onboardingSteps.findFirst({
      where: eq(onboardingSteps.id, data.stepId),
    });
    if (!step) throw new Error("Step not found");

    const allowed = await actorSharesLocationWithMember(locationIds, step.memberId);
    if (!allowed) throw new Error("No access to this member");

    await db.delete(onboardingSteps).where(eq(onboardingSteps.id, data.stepId));

    await logActivity("member", step.memberId, "onboarding_step_deleted", { step: step.title });
    return { success: true as const };
  });
