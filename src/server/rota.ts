import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { logActivity } from "@/server/activity";

/**
 * ROTA — the manager's timetable for the week ahead. Managers plan who's on,
 * when, per shop; staff check when they're working. `rota_shifts` is the
 * plan (a "HH:MM"–"HH:MM" pair for a given day), entirely separate from
 * `shifts` (the QR clock-in record) — one is intent, the other is fact.
 *
 * Only createServerFn + zod + the plain-TS `logActivity` helper are
 * statically imported here — db, auth.server, and drizzle-orm are reached
 * via dynamic `import()` inside each handler so this file stays
 * client-bundle-safe.
 */

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24h HH:MM");

/** Adds (or subtracts) whole days to a "YYYY-MM-DD" string, calendar-safe. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** True for a postgres unique-constraint violation (code 23505). */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

const CREW_ROLE_ORDER: Record<string, number> = { manager: 0, staff: 1 };

// ── reads ─────────────────────────────────────────────────────────────────

const getRotaSchema = z.object({
  locationId: z.string().uuid(),
  weekStart: dateStringSchema,
});

/**
 * The week's board for a shop: the 7 dates, the crew assigned there
 * (managers first, then staff — CEO and warehouse never appear on a rota),
 * and every planned shift within the week. Staff may view (read-only);
 * only managers may edit.
 */
export const getRota = createServerFn({ method: "GET" })
  .validator(getRotaSchema)
  .handler(async ({ data }) => {
    const { requireLocationMember } = await import("@/lib/auth.server");
    await requireLocationMember(data.locationId);

    const { db, rotaShifts, members, memberLocations } = await import("@/db");
    const { and, eq, gte, lte, inArray, asc } = await import("drizzle-orm");

    const days = Array.from({ length: 7 }, (_, i) => addDays(data.weekStart, i));

    const crewRows = await db
      .select({ id: members.id, name: members.name, role: members.role })
      .from(memberLocations)
      .innerJoin(members, eq(memberLocations.memberId, members.id))
      .where(
        and(
          eq(memberLocations.locationId, data.locationId),
          eq(members.active, true),
          inArray(members.role, ["manager", "staff"]),
        ),
      );

    const crew = crewRows
      .map((m) => ({ id: m.id, name: m.name, role: m.role as "manager" | "staff" }))
      .sort(
        (a, b) => CREW_ROLE_ORDER[a.role] - CREW_ROLE_ORDER[b.role] || a.name.localeCompare(b.name),
      );

    const entries = await db
      .select({
        id: rotaShifts.id,
        memberId: rotaShifts.memberId,
        date: rotaShifts.date,
        startTime: rotaShifts.startTime,
        endTime: rotaShifts.endTime,
        note: rotaShifts.note,
      })
      .from(rotaShifts)
      .where(
        and(
          eq(rotaShifts.locationId, data.locationId),
          gte(rotaShifts.date, days[0]),
          lte(rotaShifts.date, days[6]),
        ),
      )
      .orderBy(asc(rotaShifts.date), asc(rotaShifts.startTime));

    return { days, crew, entries };
  });

// ── writes ────────────────────────────────────────────────────────────────

const upsertRotaEntrySchema = z.object({
  id: z.string().uuid().optional(),
  locationId: z.string().uuid(),
  memberId: z.string().uuid(),
  date: dateStringSchema,
  startTime: timeStringSchema,
  endTime: timeStringSchema,
  note: z.string().trim().max(500).optional(),
});

/**
 * Manager+: plans (or edits) one shift. Overnight shifts are out of scope
 * for v1 — end must fall after start on the same day. The unique index on
 * (member, date, start) is the source of truth for "can't double-book";
 * a collision surfaces as a friendly error rather than a raw pg one.
 */
export const upsertRotaEntry = createServerFn({ method: "POST" })
  .validator(upsertRotaEntrySchema)
  .handler(async ({ data }) => {
    const { requireCapabilityAtLocation } = await import("@/lib/auth.server");

    if (data.endTime <= data.startTime) {
      throw new Error("End must be after start");
    }

    const { db, rotaShifts, memberLocations } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");

    // Editing an existing shift: authorize against where it ACTUALLY lives,
    // never the client-supplied locationId alone.
    let existing: typeof rotaShifts.$inferSelect | undefined;
    if (data.id) {
      existing = await db.query.rotaShifts.findFirst({ where: eq(rotaShifts.id, data.id) });
      if (!existing) throw new Error("Shift not found");
      if (existing.locationId !== data.locationId) throw new Error("Location mismatch");
    }

    const actor = await requireCapabilityAtLocation("set_rota", data.locationId);

    const assignment = await db.query.memberLocations.findFirst({
      where: and(
        eq(memberLocations.memberId, data.memberId),
        eq(memberLocations.locationId, data.locationId),
      ),
      with: { member: true },
    });
    if (!assignment) throw new Error("Member is not assigned to this location");

    const note = data.note?.trim() || null;

    try {
      const [row] = data.id
        ? await db
            .update(rotaShifts)
            .set({
              memberId: data.memberId,
              date: data.date,
              startTime: data.startTime,
              endTime: data.endTime,
              note,
              updatedAt: new Date(),
            })
            .where(eq(rotaShifts.id, data.id))
            .returning()
        : await db
            .insert(rotaShifts)
            .values({
              locationId: data.locationId,
              memberId: data.memberId,
              date: data.date,
              startTime: data.startTime,
              endTime: data.endTime,
              note,
              createdBy: actor.memberId,
            })
            .returning();

      await logActivity("rota_shift", row.id, "set", {
        name: assignment.member.name,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
      });

      return {
        id: row.id,
        locationId: row.locationId,
        memberId: row.memberId,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
        note: row.note,
      };
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new Error("This member already has a shift starting at that time");
      }
      throw e;
    }
  });

/** Manager+: removes a planned shift. Authorized via the entry's own location. */
export const deleteRotaEntry = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { db, rotaShifts, members } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const existing = await db.query.rotaShifts.findFirst({ where: eq(rotaShifts.id, data.id) });
    if (!existing) throw new Error("Shift not found");

    const { requireCapabilityAtLocation } = await import("@/lib/auth.server");
    await requireCapabilityAtLocation("set_rota", existing.locationId);

    const member = await db.query.members.findFirst({ where: eq(members.id, existing.memberId) });

    await db.delete(rotaShifts).where(eq(rotaShifts.id, data.id));

    await logActivity("rota_shift", data.id, "deleted", {
      name: member?.name ?? "Unknown",
      date: existing.date,
      startTime: existing.startTime,
      endTime: existing.endTime,
    });

    return { success: true as const };
  });

const copyPreviousWeekSchema = z.object({
  locationId: z.string().uuid(),
  weekStart: dateStringSchema,
});

/**
 * Manager+: duplicates every shift from the week before `weekStart` into
 * this week, same weekday offsets. Anything that would collide with an
 * already-planned shift (same member/day/start) is silently skipped —
 * that's a deliberate "don't clobber what's already been changed" choice.
 */
export const copyPreviousWeek = createServerFn({ method: "POST" })
  .validator(copyPreviousWeekSchema)
  .handler(async ({ data }) => {
    const { requireCapabilityAtLocation } = await import("@/lib/auth.server");
    const actor = await requireCapabilityAtLocation("set_rota", data.locationId);

    const { db, rotaShifts } = await import("@/db");
    const { and, eq, gte, lte } = await import("drizzle-orm");

    const prevWeekStart = addDays(data.weekStart, -7);
    const prevWeekEnd = addDays(data.weekStart, -1);

    const prevEntries = await db.query.rotaShifts.findMany({
      where: and(
        eq(rotaShifts.locationId, data.locationId),
        gte(rotaShifts.date, prevWeekStart),
        lte(rotaShifts.date, prevWeekEnd),
      ),
    });

    if (prevEntries.length === 0) {
      return { copied: 0 };
    }

    const inserted = await db
      .insert(rotaShifts)
      .values(
        prevEntries.map((e) => ({
          locationId: e.locationId,
          memberId: e.memberId,
          date: addDays(e.date, 7),
          startTime: e.startTime,
          endTime: e.endTime,
          note: e.note,
          createdBy: actor.memberId,
        })),
      )
      .onConflictDoNothing({
        target: [rotaShifts.memberId, rotaShifts.date, rotaShifts.startTime],
      })
      .returning();

    await logActivity("rota_shift", data.locationId, "copied_week", {
      weekStart: data.weekStart,
      copied: inserted.length,
    });

    return { copied: inserted.length };
  });
