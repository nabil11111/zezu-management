import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { logActivity } from "@/server/activity";
import { accessCodeSchema, shiftHours, todayDateString, type ShiftStatus } from "@/server/types";

/**
 * Clock-in & shifts. QR poster (public, per location) → 4-digit code → open
 * shift. Manager one-taps verification. Verified hours are the payroll
 * source (see listMyShifts' monthly totals).
 *
 * Only createServerFn + zod + the plain-TS helpers from @/server/types are
 * statically imported here — db, auth.server, and drizzle-orm are reached
 * via dynamic `import()` inside each handler so this file stays safe to
 * import from client-rendered routes (the public /clock/$qrToken page).
 */

/** YYYY-MM in Europe/London — used to bucket shifts into payroll months. */
function monthKeyLondon(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

/** YYYY-MM-DD in Europe/London for a timestamp. */
function dayKeyLondon(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
}

/**
 * A shift left open from a PREVIOUS business day is stale — nobody is "on
 * the clock" across days. The system can't know when the person actually
 * left, so it refuses to guess hours: the shift is closed at its own
 * clock-in time (zero hours) and REJECTED, with a note, so it never counts
 * for pay and the manager settles the real hours by hand. Runs whenever a
 * shop opens and whenever a stale shift would block someone clocking in.
 */
async function rejectStaleOpenShifts(filter: {
  locationId?: string;
  memberId?: string;
}): Promise<number> {
  const { db, shifts } = await import("@/db");
  const { and, eq, isNull } = await import("drizzle-orm");

  const open = await db.query.shifts.findMany({
    where: and(
      isNull(shifts.clockOutAt),
      filter.locationId ? eq(shifts.locationId, filter.locationId) : undefined,
      filter.memberId ? eq(shifts.memberId, filter.memberId) : undefined,
    ),
  });

  const today = todayDateString();
  const stale = open.filter((s) => dayKeyLondon(s.clockInAt) < today);

  for (const s of stale) {
    await db
      .update(shifts)
      .set({
        clockOutAt: s.clockInAt,
        status: "rejected",
        note: "Auto-closed: left on the clock overnight — hours need settling by hand",
        updatedAt: new Date(),
      })
      .where(eq(shifts.id, s.id));
    await logActivity("shift", s.id, "auto_closed_stale", { memberId: s.memberId });
  }

  return stale.length;
}

/**
 * CEO always may. Otherwise the member must hold the "open_shop" capability
 * (managers get it by default; a staff member may be granted it) AND be
 * assigned to this location.
 */
async function canOpenShop(
  member: { id: string; role: string; permissions?: unknown },
  locationId: string,
): Promise<boolean> {
  if (member.role === "ceo") return true;

  const { memberHasCapability } = await import("@/server/types");
  if (!memberHasCapability(member.role, member.permissions, "open_shop")) return false;

  const { db, memberLocations } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");

  const link = await db.query.memberLocations.findFirst({
    where: and(eq(memberLocations.memberId, member.id), eq(memberLocations.locationId, locationId)),
  });
  return Boolean(link);
}

/** Shared verify/reject logic — a still-open shift can't be judged either way. */
async function setShiftStatus(id: string, status: "verified" | "rejected") {
  const { requireCapability, getActorLocationIds, assertLocationAccess } =
    await import("@/lib/auth.server");
  const actor = await requireCapability("verify_shifts");

  const { db, shifts } = await import("@/db");
  const { eq } = await import("drizzle-orm");

  const shift = await db.query.shifts.findFirst({ where: eq(shifts.id, id) });
  if (!shift) throw new Error("Shift not found");

  const locationIds = await getActorLocationIds(actor);
  assertLocationAccess(locationIds, shift.locationId);
  if (!shift.clockOutAt) throw new Error("Still on shift");

  const [updated] = await db
    .update(shifts)
    .set({ status, verifiedBy: actor.memberId, verifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(shifts.id, id))
    .returning();

  await logActivity("shift", updated.id, status, {
    memberId: updated.memberId,
    locationId: updated.locationId,
  });

  return { success: true as const, status: updated.status as ShiftStatus };
}

// ── PUBLIC: the QR poster flow (no session) ──────────────────────────────

/** Resolves the shop behind a poster's token + whether it's open today. */
export const getClockContext = createServerFn({ method: "GET" })
  .validator(z.object({ qrToken: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { db, locations, shopDays } = await import("@/db");
    const { and, eq, isNull } = await import("drizzle-orm");

    const location = await db.query.locations.findFirst({
      where: and(eq(locations.qrToken, data.qrToken), eq(locations.active, true)),
    });
    if (!location) throw new Error("Unknown QR");

    const date = todayDateString();
    const shopDay = await db.query.shopDays.findFirst({
      where: and(
        eq(shopDays.locationId, location.id),
        eq(shopDays.date, date),
        isNull(shopDays.closedAt),
      ),
    });

    return {
      locationName: location.name,
      isOpen: Boolean(shopDay),
      date,
    };
  });

/** The tap: resolves member by code, clocks in/out, or reports why not. */
export const clockAction = createServerFn({ method: "POST" })
  .validator(z.object({ qrToken: z.string().min(1), code: accessCodeSchema }))
  .handler(async ({ data }) => {
    const { hashCode } = await import("@/lib/auth.server");
    const { db, locations, members, shopDays, shifts } = await import("@/db");
    const { and, eq, isNull } = await import("drizzle-orm");

    const location = await db.query.locations.findFirst({
      where: and(eq(locations.qrToken, data.qrToken), eq(locations.active, true)),
    });
    if (!location) throw new Error("Unknown QR");

    const member = await db.query.members.findFirst({
      where: and(eq(members.codeHash, hashCode(data.code)), eq(members.active, true)),
    });
    if (!member) throw new Error("Invalid code");

    // Anyone already on the clock somewhere resolves that shift first —
    // either clocking out here, or being told to go clock out there. A
    // shift dangling from a previous day doesn't count: it gets auto-closed
    // (rejected, zero hours) and this tap becomes a normal clock-in.
    let openShift = await db.query.shifts.findFirst({
      where: and(eq(shifts.memberId, member.id), isNull(shifts.clockOutAt)),
    });
    if (openShift && dayKeyLondon(openShift.clockInAt) < todayDateString()) {
      await rejectStaleOpenShifts({ memberId: member.id });
      openShift = undefined;
    }

    if (openShift) {
      if (openShift.locationId === location.id) {
        const clockOutAt = new Date();
        // Managers' clock in/out doesn't need a second person to sign off —
        // closing out their own shift auto-verifies it on the spot, so it
        // never lands in the verification queue.
        const isManager = member.role === "manager";
        const [updated] = await db
          .update(shifts)
          .set({
            clockOutAt,
            updatedAt: clockOutAt,
            ...(isManager
              ? { status: "verified" as const, verifiedBy: member.id, verifiedAt: clockOutAt }
              : {}),
          })
          .where(eq(shifts.id, openShift.id))
          .returning();

        await logActivity(
          "shift",
          updated.id,
          "clocked_out",
          { locationName: location.name },
          { id: member.id, name: member.name },
        );

        const clockInIso = updated.clockInAt.toISOString();
        const clockOutIso = updated.clockOutAt!.toISOString();
        return {
          kind: "clocked_out" as const,
          name: member.name,
          clockInAt: clockInIso,
          clockOutAt: clockOutIso,
          hours: shiftHours(clockInIso, clockOutIso),
        };
      }

      const otherLocation = await db.query.locations.findFirst({
        where: eq(locations.id, openShift.locationId),
      });

      return {
        kind: "open_elsewhere" as const,
        name: member.name,
        locationName: otherLocation?.name ?? "another shop",
      };
    }

    // No open shift anywhere — this is a clock-IN attempt.
    const today = todayDateString();
    const shopDay = await db.query.shopDays.findFirst({
      where: and(
        eq(shopDays.locationId, location.id),
        eq(shopDays.date, today),
        isNull(shopDays.closedAt),
      ),
    });

    // The CEO doesn't clock in — they can start the day, but once the shop's
    // already running there's nothing here for them except a friendly nudge.
    if (member.role === "ceo") {
      if (!shopDay) {
        return { kind: "can_open" as const, name: member.name };
      }
      return { kind: "ceo_ack" as const, name: member.name };
    }

    if (!shopDay) {
      const allowed = await canOpenShop(member, location.id);
      if (allowed) {
        return { kind: "can_open" as const, name: member.name };
      }
      return { kind: "shop_closed" as const, name: member.name };
    }

    const [shift] = await db
      .insert(shifts)
      .values({ memberId: member.id, locationId: location.id, status: "pending" })
      .returning();

    await logActivity(
      "shift",
      shift.id,
      "clocked_in",
      { locationName: location.name },
      { id: member.id, name: member.name },
    );

    return {
      kind: "clocked_in" as const,
      name: member.name,
      clockInAt: shift.clockInAt.toISOString(),
    };
  });

/** The "can_open" follow-up: opens today's shop day and clocks the opener in. */
export const openShopViaQr = createServerFn({ method: "POST" })
  .validator(z.object({ qrToken: z.string().min(1), code: accessCodeSchema }))
  .handler(async ({ data }) => {
    const { hashCode } = await import("@/lib/auth.server");
    const { db, locations, members, shopDays, shifts } = await import("@/db");
    const { and, eq, isNull } = await import("drizzle-orm");

    const location = await db.query.locations.findFirst({
      where: and(eq(locations.qrToken, data.qrToken), eq(locations.active, true)),
    });
    if (!location) throw new Error("Unknown QR");

    const member = await db.query.members.findFirst({
      where: and(eq(members.codeHash, hashCode(data.code)), eq(members.active, true)),
    });
    if (!member) throw new Error("Invalid code");

    const allowed = await canOpenShop(member, location.id);
    if (!allowed) throw new Error("Not authorized to open this shop");

    const today = todayDateString();

    await db
      .insert(shopDays)
      .values({ locationId: location.id, date: today, openedBy: member.id })
      .onConflictDoNothing({ target: [shopDays.locationId, shopDays.date] });

    // Opening starts a clean day: anyone left "on the clock" from a previous
    // day is auto-closed (rejected, zero hours) before the new day begins.
    await rejectStaleOpenShifts({ locationId: location.id });

    const shopDay = await db.query.shopDays.findFirst({
      where: and(eq(shopDays.locationId, location.id), eq(shopDays.date, today)),
    });
    if (!shopDay) throw new Error("Could not open shop");

    await logActivity(
      "shop_day",
      shopDay.id,
      "opened_via_qr",
      { locationName: location.name },
      { id: member.id, name: member.name },
    );

    // The CEO opens the shop but never clocks in — nothing to insert.
    if (member.role === "ceo") {
      return {
        kind: "opened" as const,
        name: member.name,
        locationName: location.name,
      };
    }

    // Don't double-clock-in if this member is already on an open shift
    // somewhere (shouldn't happen on the happy path, but stay safe).
    const existingOpenShift = await db.query.shifts.findFirst({
      where: and(eq(shifts.memberId, member.id), isNull(shifts.clockOutAt)),
    });

    if (!existingOpenShift) {
      const [shift] = await db
        .insert(shifts)
        .values({ memberId: member.id, locationId: location.id, status: "pending" })
        .returning();

      await logActivity(
        "shift",
        shift.id,
        "clocked_in",
        { locationName: location.name },
        { id: member.id, name: member.name },
      );
    }

    return {
      kind: "opened_and_clocked_in" as const,
      name: member.name,
      locationName: location.name,
    };
  });

// ── AUTHED: manager verification + shop-day control ──────────────────────

/** The /shifts board: shop-day status, the verification queue, recent history. */
export const getShiftBoard = createServerFn({ method: "GET" })
  .validator(
    z
      .object({
        locationId: z.string().uuid().optional(),
        days: z.number().int().min(1).max(90).optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    // Anyone who can reach the /shifts page holds verify_shifts (nav gates on
    // it); this board is what they land on, so it's gated the same way
    // rather than manager-only.
    const { requireCapability, getActorLocationIds, assertLocationAccess } =
      await import("@/lib/auth.server");
    const actor = await requireCapability("verify_shifts");
    const locationIds = await getActorLocationIds(actor);

    if (data?.locationId) {
      assertLocationAccess(locationIds, data.locationId);
    }

    if (locationIds !== "all" && locationIds.length === 0) {
      return { locations: [], shopToday: [], pending: [], recent: [] };
    }

    const { db, locations, shopDays, shifts, members } = await import("@/db");
    const { and, eq, gte, desc, asc, inArray } = await import("drizzle-orm");

    const accessibleLocations = await db.query.locations.findMany({
      where: locationIds === "all" ? undefined : inArray(locations.id, locationIds),
      orderBy: [asc(locations.sortOrder)],
    });

    const scopedLocations = data?.locationId
      ? accessibleLocations.filter((l) => l.id === data.locationId)
      : accessibleLocations;
    const scopedIds = scopedLocations.map((l) => l.id);

    const today = todayDateString();
    const days = data?.days ?? 14;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [shopDayRows, shiftRows] = scopedIds.length
      ? await Promise.all([
          db.query.shopDays.findMany({
            where: and(inArray(shopDays.locationId, scopedIds), eq(shopDays.date, today)),
          }),
          db.query.shifts.findMany({
            where: and(inArray(shifts.locationId, scopedIds), gte(shifts.clockInAt, since)),
            orderBy: [desc(shifts.clockInAt)],
          }),
        ])
      : [[], []];

    const memberIds = Array.from(
      new Set([...shiftRows.map((s) => s.memberId), ...shopDayRows.map((sd) => sd.openedBy)]),
    );
    const memberRows = memberIds.length
      ? await db.query.members.findMany({ where: inArray(members.id, memberIds) })
      : [];
    const memberName = new Map(memberRows.map((m) => [m.id, m.name]));
    const locationName = new Map(scopedLocations.map((l) => [l.id, l.name]));

    const shopToday = scopedLocations.map((loc) => {
      const sd = shopDayRows.find((r) => r.locationId === loc.id);
      return {
        locationId: loc.id,
        locationName: loc.name,
        shopDay: sd
          ? {
              openedAt: sd.openedAt.toISOString(),
              openedByName: memberName.get(sd.openedBy) ?? "Unknown",
              closedAt: sd.closedAt ? sd.closedAt.toISOString() : null,
            }
          : null,
      };
    });

    function shapeShift(s: (typeof shiftRows)[number]) {
      const clockInIso = s.clockInAt.toISOString();
      const clockOutIso = s.clockOutAt ? s.clockOutAt.toISOString() : null;
      return {
        id: s.id,
        memberName: memberName.get(s.memberId) ?? "Unknown",
        locationName: locationName.get(s.locationId) ?? "Unknown",
        clockInAt: clockInIso,
        clockOutAt: clockOutIso,
        hours: shiftHours(clockInIso, clockOutIso),
        status: s.status as ShiftStatus,
      };
    }

    const pending = shiftRows
      .filter((s) => s.status === "pending")
      .map(shapeShift)
      .sort((a, b) => new Date(a.clockInAt).getTime() - new Date(b.clockInAt).getTime());

    const recent = shiftRows.map(shapeShift);

    return {
      locations: accessibleLocations.map((l) => ({ id: l.id, name: l.name })),
      shopToday,
      pending,
      recent,
    };
  });

/** Manager one-tap: approve a completed shift for payroll. */
export const verifyShift = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => setShiftStatus(data.id, "verified"));

/** Manager one-tap: reject a completed shift (won't count for payroll). */
export const rejectShift = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => setShiftStatus(data.id, "rejected"));

/** Manager control: open today's shop day for a location. Conflict-safe. */
export const openShop = createServerFn({ method: "POST" })
  .validator(z.object({ locationId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { requireCapabilityAtLocation } = await import("@/lib/auth.server");
    const actor = await requireCapabilityAtLocation("open_shop", data.locationId);

    const { db, shopDays, locations, members } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");

    const location = await db.query.locations.findFirst({
      where: eq(locations.id, data.locationId),
    });
    if (!location) throw new Error("Location not found");

    const today = todayDateString();

    await db
      .insert(shopDays)
      .values({ locationId: data.locationId, date: today, openedBy: actor.memberId })
      .onConflictDoNothing({ target: [shopDays.locationId, shopDays.date] });

    // Same clean-slate sweep as the QR open: no cross-day stragglers.
    await rejectStaleOpenShifts({ locationId: data.locationId });

    const shopDay = await db.query.shopDays.findFirst({
      where: and(eq(shopDays.locationId, data.locationId), eq(shopDays.date, today)),
    });
    if (!shopDay) throw new Error("Could not open shop");

    const opener = await db.query.members.findFirst({ where: eq(members.id, shopDay.openedBy) });

    await logActivity("shop_day", shopDay.id, "opened", { locationName: location.name });

    return {
      locationId: shopDay.locationId,
      openedAt: shopDay.openedAt.toISOString(),
      openedByName: opener?.name ?? "Unknown",
      closedAt: shopDay.closedAt ? shopDay.closedAt.toISOString() : null,
    };
  });

/**
 * Manager control: close today's shop day for a location. Closing clocks
 * everyone out — nobody should still be "on the clock" once the shop's shut.
 * Managers' own shifts are auto-verified in the same stroke (their clock
 * in/out doesn't need a second person to sign off); staff shifts stay
 * 'pending' for the usual verification queue.
 */
export const closeShop = createServerFn({ method: "POST" })
  .validator(z.object({ locationId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { requireCapabilityAtLocation } = await import("@/lib/auth.server");
    const actor = await requireCapabilityAtLocation("open_shop", data.locationId);

    const { db, shopDays, locations, members, shifts } = await import("@/db");
    const { and, eq, isNull, inArray } = await import("drizzle-orm");

    const today = todayDateString();
    const existing = await db.query.shopDays.findFirst({
      where: and(
        eq(shopDays.locationId, data.locationId),
        eq(shopDays.date, today),
        isNull(shopDays.closedAt),
      ),
    });
    if (!existing) throw new Error("Shop is not open");

    const closedAt = new Date();

    const [updated] = await db
      .update(shopDays)
      .set({ closedAt, updatedAt: closedAt })
      .where(eq(shopDays.id, existing.id))
      .returning();

    const location = await db.query.locations.findFirst({
      where: eq(locations.id, data.locationId),
    });
    const opener = await db.query.members.findFirst({ where: eq(members.id, updated.openedBy) });

    // Clock out every shift still open at this location. Managers get
    // auto-verified (verifiedBy = the person closing the shop); staff shifts
    // stay pending, same as any other clock-out.
    const openShifts = await db.query.shifts.findMany({
      where: and(eq(shifts.locationId, data.locationId), isNull(shifts.clockOutAt)),
    });

    let clockedOutCount = 0;
    if (openShifts.length) {
      const openMemberIds = Array.from(new Set(openShifts.map((s) => s.memberId)));
      const openMembers = await db.query.members.findMany({
        where: inArray(members.id, openMemberIds),
      });
      const memberRole = new Map(openMembers.map((m) => [m.id, m.role]));

      await Promise.all(
        openShifts.map((s) => {
          const isManager = memberRole.get(s.memberId) === "manager";
          return db
            .update(shifts)
            .set({
              clockOutAt: closedAt,
              updatedAt: closedAt,
              ...(isManager
                ? { status: "verified" as const, verifiedBy: actor.memberId, verifiedAt: closedAt }
                : {}),
            })
            .where(eq(shifts.id, s.id));
        }),
      );
      clockedOutCount = openShifts.length;
    }

    await logActivity("shop_day", updated.id, "closed", {
      locationName: location?.name,
      clockedOutCount,
    });

    return {
      locationId: updated.locationId,
      openedAt: updated.openedAt.toISOString(),
      openedByName: opener?.name ?? "Unknown",
      closedAt: updated.closedAt!.toISOString(),
      clockedOutCount,
    };
  });

// ── AUTHED: the crew's own timesheet ──────────────────────────────────────

/** Own shifts + open shift + last-6-months totals — the payroll story. */
export const listMyShifts = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAuth } = await import("@/lib/auth.server");
  const actor = await requireAuth();

  const { db, shifts, locations, members } = await import("@/db");
  const { eq, desc, and, gte, inArray } = await import("drizzle-orm");

  const member = await db.query.members.findFirst({ where: eq(members.id, actor.memberId) });
  const hourlyRate = member?.hourlyRate != null ? Number(member.hourlyRate) : null;

  const recentShifts = await db.query.shifts.findMany({
    where: eq(shifts.memberId, actor.memberId),
    orderBy: [desc(shifts.clockInAt)],
    limit: 60,
  });

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const totalsShifts = await db.query.shifts.findMany({
    where: and(eq(shifts.memberId, actor.memberId), gte(shifts.clockInAt, sixMonthsAgo)),
  });

  const relevantLocationIds = Array.from(
    new Set([...recentShifts.map((s) => s.locationId), ...totalsShifts.map((s) => s.locationId)]),
  );
  const locationRows = relevantLocationIds.length
    ? await db.query.locations.findMany({ where: inArray(locations.id, relevantLocationIds) })
    : [];
  const locationName = new Map(locationRows.map((l) => [l.id, l.name]));

  const openShift = recentShifts.find((s) => s.clockOutAt === null) ?? null;

  const shapedShifts = recentShifts.map((s) => {
    const clockInIso = s.clockInAt.toISOString();
    const clockOutIso = s.clockOutAt ? s.clockOutAt.toISOString() : null;
    return {
      id: s.id,
      locationName: locationName.get(s.locationId) ?? "Unknown",
      clockInAt: clockInIso,
      clockOutAt: clockOutIso,
      hours: shiftHours(clockInIso, clockOutIso),
      status: s.status as ShiftStatus,
    };
  });

  // Six calendar-month buckets (Europe/London), oldest → newest, then
  // flipped so the most recent month leads — matches "recent first" feel.
  const monthKeys: string[] = [];
  const cursor = new Date(sixMonthsAgo);
  for (let i = 0; i < 6; i++) {
    monthKeys.push(monthKeyLondon(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const monthly = monthKeys
    .map((month) => {
      const inMonth = totalsShifts.filter((s) => monthKeyLondon(s.clockInAt) === month);
      const verifiedHours = inMonth
        .filter((s) => s.status === "verified")
        .reduce((sum, s) => {
          const h = shiftHours(
            s.clockInAt.toISOString(),
            s.clockOutAt ? s.clockOutAt.toISOString() : null,
          );
          return sum + (h ?? 0);
        }, 0);
      const pendingHours = inMonth
        .filter((s) => s.status === "pending")
        .reduce((sum, s) => {
          const h = shiftHours(
            s.clockInAt.toISOString(),
            s.clockOutAt ? s.clockOutAt.toISOString() : null,
          );
          return sum + (h ?? 0);
        }, 0);

      return {
        month,
        verifiedHours: Math.round(verifiedHours * 100) / 100,
        pendingHours: Math.round(pendingHours * 100) / 100,
        estimatedPay:
          hourlyRate !== null ? Math.round(verifiedHours * hourlyRate * 100) / 100 : null,
      };
    })
    .reverse();

  return {
    shifts: shapedShifts,
    openShift: openShift
      ? {
          id: openShift.id,
          locationName: locationName.get(openShift.locationId) ?? "Unknown",
          clockInAt: openShift.clockInAt.toISOString(),
        }
      : null,
    monthly,
  };
});
