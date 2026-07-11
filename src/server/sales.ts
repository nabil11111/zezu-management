import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { logActivity } from "@/server/activity";
import { todayDateString } from "@/server/types";

/**
 * Daily sales: one row per location per day (uber / takeaway / dine-in).
 * numeric columns are written as strings and parsed back with Number() for
 * JS maths; date columns are plain "YYYY-MM-DD" strings.
 */

const salesEntryInput = z.object({
  locationId: z.string().uuid(),
  date: z.string().optional(),
  uber: z.number().min(0),
  takeaway: z.number().min(0),
  dineIn: z.number().min(0),
  note: z.string().optional().nullable(),
});

/** Auth-gated (manager+): create or replace the day's numbers for a site. */
export const upsertSalesEntry = createServerFn({ method: "POST" })
  .validator(salesEntryInput)
  .handler(async ({ data }) => {
    const { requireManager, assertLocationAccess } = await import("@/lib/auth.server");
    const { actor, locationIds } = await requireManager();
    assertLocationAccess(locationIds, data.locationId);

    const date = data.date ?? todayDateString();
    const note = data.note?.trim() || null;

    const { db, salesEntries, locations } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const [row] = await db
      .insert(salesEntries)
      .values({
        locationId: data.locationId,
        date,
        uber: String(data.uber),
        takeaway: String(data.takeaway),
        dineIn: String(data.dineIn),
        note,
        byMemberId: actor.memberId,
      })
      .onConflictDoUpdate({
        target: [salesEntries.locationId, salesEntries.date],
        set: {
          uber: String(data.uber),
          takeaway: String(data.takeaway),
          dineIn: String(data.dineIn),
          note,
          byMemberId: actor.memberId,
          updatedAt: new Date(),
        },
      })
      .returning();

    const location = await db.query.locations.findFirst({
      where: eq(locations.id, data.locationId),
      columns: { name: true },
    });

    await logActivity("sales_entry", row.id, "logged", {
      locationName: location?.name ?? null,
      date,
      total: data.uber + data.takeaway + data.dineIn,
    });

    return {
      id: row.id,
      locationId: row.locationId,
      date: row.date,
      uber: Number(row.uber),
      takeaway: Number(row.takeaway),
      dineIn: Number(row.dineIn),
      note: row.note,
      byMemberId: row.byMemberId,
    };
  });

/** Auth-gated (manager+): the entry for one site/day, or null — prefills the entry form. */
export const getEntryForDay = createServerFn({ method: "GET" })
  .validator(z.object({ locationId: z.string().uuid(), date: z.string() }))
  .handler(async ({ data }) => {
    const { requireManager, assertLocationAccess } = await import("@/lib/auth.server");
    const { locationIds } = await requireManager();
    assertLocationAccess(locationIds, data.locationId);

    const { db, salesEntries } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");

    const row = await db.query.salesEntries.findFirst({
      where: and(eq(salesEntries.locationId, data.locationId), eq(salesEntries.date, data.date)),
    });

    if (!row) return null;

    return {
      id: row.id,
      locationId: row.locationId,
      date: row.date,
      uber: Number(row.uber),
      takeaway: Number(row.takeaway),
      dineIn: Number(row.dineIn),
      note: row.note,
      byMemberId: row.byMemberId,
    };
  });

const dashboardInput = z
  .object({
    locationId: z.string().uuid().optional(),
    days: z.number().int().min(1).max(90).optional(),
  })
  .optional();

interface ChannelTotals {
  uber: number;
  takeaway: number;
  dineIn: number;
}

/** Zero-filled shape for actors with no accessible locations yet. */
function emptyDashboard(days: number) {
  const daily = Array.from({ length: days }, (_, i) => ({
    date: todayDateString(-(days - 1) + i),
    uber: 0,
    takeaway: 0,
    dineIn: 0,
    total: 0,
  }));
  return {
    locations: [] as Array<{ id: string; name: string }>,
    daily,
    byLocation: [] as Array<{
      locationId: string;
      name: string;
      total: number;
      uber: number;
      takeaway: number;
      dineIn: number;
      daysLogged: number;
    }>,
    today: { total: 0, uber: 0, takeaway: 0, dineIn: 0, logged: false },
    lastWeekSameDay: { total: 0 },
    weekTotal: 0,
    prevWeekTotal: 0,
    channelMix: { uber: 0, takeaway: 0, dineIn: 0 } as ChannelTotals,
    bestDay: null as { date: string; total: number } | null,
    worstDay: null as { date: string; total: number } | null,
    missingYesterday: [] as Array<{ locationId: string; name: string }>,
    recentEntries: [] as Array<{
      id: string;
      date: string;
      locationId: string;
      locationName: string;
      uber: number;
      takeaway: number;
      dineIn: number;
      total: number;
      note: string | null;
      byMemberName: string | null;
    }>,
  };
}

/**
 * Auth-gated (manager+): the sales dashboard — today vs last week, site vs
 * site, the channel mix, and the best/worst days on record.
 */
export const getSalesDashboard = createServerFn({ method: "GET" })
  .validator(dashboardInput)
  .handler(async ({ data }) => {
    const { requireManager, assertLocationAccess } = await import("@/lib/auth.server");
    const { locationIds } = await requireManager();

    const days = data?.days ?? 30;

    if (data?.locationId) {
      assertLocationAccess(locationIds, data.locationId);
    }

    const { db, salesEntries, locations } = await import("@/db");
    const { and, eq, gte, lte, inArray, asc, desc, sql } = await import("drizzle-orm");

    const accessibleWhere =
      locationIds === "all"
        ? eq(locations.active, true)
        : and(eq(locations.active, true), inArray(locations.id, locationIds));

    const accessibleLocations = await db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(accessibleWhere)
      .orderBy(asc(locations.sortOrder), asc(locations.name));

    const accessibleLocationIds = accessibleLocations.map((l) => l.id);

    if (accessibleLocationIds.length === 0) {
      return emptyDashboard(days);
    }

    const scopeLocationIds = data?.locationId ? [data.locationId] : accessibleLocationIds;

    const today = todayDateString();
    const yesterday = todayDateString(-1);
    const startDate = todayDateString(-(days - 1));
    const lastWeekDate = todayDateString(-7);
    const prevWeekStart = todayDateString(-13);

    // Daily totals across the selected scope, for the window (zero-filled).
    const dailyRows = await db
      .select({
        date: salesEntries.date,
        uber: sql<string>`coalesce(sum(${salesEntries.uber}), 0)`,
        takeaway: sql<string>`coalesce(sum(${salesEntries.takeaway}), 0)`,
        dineIn: sql<string>`coalesce(sum(${salesEntries.dineIn}), 0)`,
      })
      .from(salesEntries)
      .where(
        and(
          inArray(salesEntries.locationId, scopeLocationIds),
          gte(salesEntries.date, startDate),
          lte(salesEntries.date, today),
        ),
      )
      .groupBy(salesEntries.date);

    const dailyMap = new Map(
      dailyRows.map((r) => [
        r.date,
        { uber: Number(r.uber), takeaway: Number(r.takeaway), dineIn: Number(r.dineIn) },
      ]),
    );

    const daily = Array.from({ length: days }, (_, i) => {
      const date = todayDateString(-(days - 1) + i);
      const row = dailyMap.get(date) ?? { uber: 0, takeaway: 0, dineIn: 0 };
      return { date, ...row, total: row.uber + row.takeaway + row.dineIn };
    });

    const channelMix = daily.reduce<ChannelTotals>(
      (acc, d) => {
        acc.uber += d.uber;
        acc.takeaway += d.takeaway;
        acc.dineIn += d.dineIn;
        return acc;
      },
      { uber: 0, takeaway: 0, dineIn: 0 },
    );

    // Per-location totals for the same window — always ALL accessible sites
    // (site vs site should compare, not just show the one currently filtered).
    const byLocationRows = await db
      .select({
        locationId: salesEntries.locationId,
        uber: sql<string>`coalesce(sum(${salesEntries.uber}), 0)`,
        takeaway: sql<string>`coalesce(sum(${salesEntries.takeaway}), 0)`,
        dineIn: sql<string>`coalesce(sum(${salesEntries.dineIn}), 0)`,
        daysLogged: sql<string>`count(*)`,
      })
      .from(salesEntries)
      .where(
        and(
          inArray(salesEntries.locationId, accessibleLocationIds),
          gte(salesEntries.date, startDate),
          lte(salesEntries.date, today),
        ),
      )
      .groupBy(salesEntries.locationId);

    const byLocationMap = new Map(byLocationRows.map((r) => [r.locationId, r]));
    const byLocation = accessibleLocations.map((loc) => {
      const r = byLocationMap.get(loc.id);
      const uber = r ? Number(r.uber) : 0;
      const takeaway = r ? Number(r.takeaway) : 0;
      const dineIn = r ? Number(r.dineIn) : 0;
      return {
        locationId: loc.id,
        name: loc.name,
        uber,
        takeaway,
        dineIn,
        total: uber + takeaway + dineIn,
        daysLogged: r ? Number(r.daysLogged) : 0,
      };
    });

    // Today's numbers for the selected scope (breakdown + whether it's logged).
    const [todayRow] = await db
      .select({
        uber: sql<string>`coalesce(sum(${salesEntries.uber}), 0)`,
        takeaway: sql<string>`coalesce(sum(${salesEntries.takeaway}), 0)`,
        dineIn: sql<string>`coalesce(sum(${salesEntries.dineIn}), 0)`,
        count: sql<string>`count(*)`,
      })
      .from(salesEntries)
      .where(and(inArray(salesEntries.locationId, scopeLocationIds), eq(salesEntries.date, today)));

    const todayUber = Number(todayRow?.uber ?? 0);
    const todayTakeaway = Number(todayRow?.takeaway ?? 0);
    const todayDineIn = Number(todayRow?.dineIn ?? 0);
    const todayLogged = Number(todayRow?.count ?? 0) > 0;

    // Last 14 days of totals-by-date for the scope — covers this week, last
    // week, and "same day last week" in a single grouped query.
    const recentRows = await db
      .select({
        date: salesEntries.date,
        total: sql<string>`coalesce(sum(${salesEntries.uber} + ${salesEntries.takeaway} + ${salesEntries.dineIn}), 0)`,
      })
      .from(salesEntries)
      .where(
        and(
          inArray(salesEntries.locationId, scopeLocationIds),
          gte(salesEntries.date, prevWeekStart),
          lte(salesEntries.date, today),
        ),
      )
      .groupBy(salesEntries.date);

    const recentMap = new Map(recentRows.map((r) => [r.date, Number(r.total)]));

    let weekTotal = 0;
    let prevWeekTotal = 0;
    for (let i = 0; i < 7; i++) weekTotal += recentMap.get(todayDateString(-i)) ?? 0;
    for (let i = 7; i < 14; i++) prevWeekTotal += recentMap.get(todayDateString(-i)) ?? 0;
    const lastWeekSameDayTotal = recentMap.get(lastWeekDate) ?? 0;

    // Best / worst day on record (all time, scoped) — only days with entries.
    const recordRows = await db
      .select({
        date: salesEntries.date,
        total: sql<string>`sum(${salesEntries.uber} + ${salesEntries.takeaway} + ${salesEntries.dineIn})`,
      })
      .from(salesEntries)
      .where(inArray(salesEntries.locationId, scopeLocationIds))
      .groupBy(salesEntries.date);

    let bestDay: { date: string; total: number } | null = null;
    let worstDay: { date: string; total: number } | null = null;
    for (const r of recordRows) {
      const total = Number(r.total);
      if (!bestDay || total > bestDay.total) bestDay = { date: r.date, total };
      if (!worstDay || total < worstDay.total) worstDay = { date: r.date, total };
    }

    // Sites (of ALL accessible ones) that haven't logged yesterday.
    const loggedYesterdayRows = await db
      .select({ locationId: salesEntries.locationId })
      .from(salesEntries)
      .where(
        and(
          inArray(salesEntries.locationId, accessibleLocationIds),
          eq(salesEntries.date, yesterday),
        ),
      );
    const loggedYesterdaySet = new Set(loggedYesterdayRows.map((r) => r.locationId));
    const missingYesterday = accessibleLocations
      .filter((l) => !loggedYesterdaySet.has(l.id))
      .map((l) => ({ locationId: l.id, name: l.name }));

    // Recent entries (scoped) for the "recent entries" table — click a row to edit it.
    const recentEntryRows = await db.query.salesEntries.findMany({
      where: and(
        inArray(salesEntries.locationId, scopeLocationIds),
        gte(salesEntries.date, startDate),
        lte(salesEntries.date, today),
      ),
      orderBy: [desc(salesEntries.date), desc(salesEntries.createdAt)],
      limit: 30,
      with: {
        location: { columns: { name: true } },
        by: { columns: { name: true } },
      },
    });

    const recentEntries = recentEntryRows.map((r) => {
      const uber = Number(r.uber);
      const takeaway = Number(r.takeaway);
      const dineIn = Number(r.dineIn);
      return {
        id: r.id,
        date: r.date,
        locationId: r.locationId,
        locationName: r.location?.name ?? "—",
        uber,
        takeaway,
        dineIn,
        total: uber + takeaway + dineIn,
        note: r.note,
        byMemberName: r.by?.name ?? null,
      };
    });

    return {
      locations: accessibleLocations,
      daily,
      byLocation,
      today: {
        total: todayUber + todayTakeaway + todayDineIn,
        uber: todayUber,
        takeaway: todayTakeaway,
        dineIn: todayDineIn,
        logged: todayLogged,
      },
      lastWeekSameDay: { total: lastWeekSameDayTotal },
      weekTotal,
      prevWeekTotal,
      channelMix,
      bestDay,
      worstDay,
      missingYesterday,
      recentEntries,
    };
  });
