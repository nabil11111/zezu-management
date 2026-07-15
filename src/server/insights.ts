import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { shiftHours, todayDateString } from "@/server/types";

/**
 * CEO INSIGHTS — the one screen that rolls every module up: sales, labour,
 * stock orders, and payroll, sliced by month, site by site.
 *
 * CEO-only. Deliberately its own module with its own queries (not a
 * reassembly of sales.ts/stock.ts/shifts.ts/people.ts/orders.ts, which are
 * being edited elsewhere) — everything here reads straight off the schema.
 *
 * Only createServerFn + zod + the plain-TS helpers from @/server/types are
 * statically imported; db, auth.server, and drizzle-orm are reached via
 * dynamic import() inside the handler, matching the rest of the app.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Calendar date (YYYY-MM-DD) for a Date, in the business's timezone. */
function londonDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
}

/** "YYYY-MM" for a Date, in the business's timezone. */
function londonMonthKey(d: Date): string {
  return londonDateString(d).slice(0, 7);
}

/** ISO-8601 week number (Monday-start) for a "YYYY-MM-DD" date string. */
function isoWeekInfo(dateStr: string): { year: number; week: number } {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // Thursday of this ISO week
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week =
    1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return { year: target.getUTCFullYear(), week };
}

interface SalesTotals {
  total: number;
  uber: number;
  takeaway: number;
  dineIn: number;
  daysLogged: number;
  avgPerDay: number;
}

interface SiteInsight {
  id: string;
  name: string;
  sales: SalesTotals;
  hours: { verified: number; pending: number };
  labourCost: number;
  labourPct: number | null;
  orders: { placed: number; received: number; shortfallItems: number };
}

type Totals = Omit<SiteInsight, "id" | "name">;

interface Insights {
  month: string;
  /** Every active site — for the store filter picker, regardless of scope. */
  allSites: Array<{ id: string; name: string }>;
  sites: SiteInsight[];
  totals: Totals;
  bestDay: { date: string; siteName: string; total: number } | null;
  worstDay: { date: string; siteName: string; total: number } | null;
  weekly: Array<{ weekLabel: string; total: number }>;
  payroll: { outstandingHours: number; outstandingAmount: number };
}

const insightsInput = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/, "Use YYYY-MM")
      .optional(),
    // Scope everything (sales, hours, orders, weekly, payroll) to one store.
    locationId: z.string().uuid().optional(),
  })
  .optional();

const emptyTotals: Totals = {
  sales: { total: 0, uber: 0, takeaway: 0, dineIn: 0, daysLogged: 0, avgPerDay: 0 },
  hours: { verified: 0, pending: 0 },
  labourCost: 0,
  labourPct: null,
  orders: { placed: 0, received: 0, shortfallItems: 0 },
};

/** CEO-only: the monthly rollup — sales, labour, orders, per site, plus payroll owed. */
export const getInsights = createServerFn({ method: "GET" })
  .validator(insightsInput)
  .handler(async ({ data }): Promise<Insights> => {
    const { requireCeo } = await import("@/lib/auth.server");
    await requireCeo();

    const {
      db,
      locations,
      salesEntries,
      shifts,
      members,
      memberLocations,
      stockOrders,
      stockOrderItems,
      memberPayments,
    } = await import("@/db");
    const { and, asc, eq, ne, gte, lt, lte, inArray, isNotNull, sql } = await import("drizzle-orm");

    const month = data?.month ?? todayDateString().slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    const monthStart = `${month}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

    // Generous timestamp padding (real UK offset is at most 1hr) so no
    // shift/order right at a month boundary is missed before the exact
    // Europe/London-calendar refinement below.
    const paddedStart = new Date(Date.UTC(y, m - 1, 1) - 2 * 24 * 3600 * 1000);
    const paddedEnd = new Date(Date.UTC(y, m, 1) + 2 * 24 * 3600 * 1000);
    const inTargetMonth = (d: Date) => londonMonthKey(d) === month;

    // ── all-time payroll (independent of active sites / month) ──────────
    const verifiedHoursRows = await db
      .select({
        memberId: shifts.memberId,
        hours: sql<string>`coalesce(sum(extract(epoch from (${shifts.clockOutAt} - ${shifts.clockInAt})) / 3600), 0)`,
      })
      .from(shifts)
      .where(and(eq(shifts.status, "verified"), isNotNull(shifts.clockOutAt)))
      .groupBy(shifts.memberId);

    const paidHoursRows = await db
      .select({
        memberId: memberPayments.memberId,
        hours: sql<string>`coalesce(sum(${memberPayments.hours}), 0)`,
      })
      .from(memberPayments)
      .groupBy(memberPayments.memberId);

    // When a store filter is active, payroll counts only that store's crew.
    const payrollMembers = await db
      .select({ id: members.id, hourlyRate: members.hourlyRate })
      .from(members)
      .where(
        and(
          ne(members.role, "ceo"),
          data?.locationId
            ? inArray(
                members.id,
                db
                  .select({ id: memberLocations.memberId })
                  .from(memberLocations)
                  .where(eq(memberLocations.locationId, data.locationId)),
              )
            : undefined,
        ),
      );

    const verifiedHoursMap = new Map(verifiedHoursRows.map((r) => [r.memberId, Number(r.hours)]));
    const paidHoursMap = new Map(paidHoursRows.map((r) => [r.memberId, Number(r.hours)]));

    let outstandingHours = 0;
    let outstandingAmount = 0;
    for (const mem of payrollMembers) {
      const verified = verifiedHoursMap.get(mem.id) ?? 0;
      const paid = paidHoursMap.get(mem.id) ?? 0;
      const outstanding = Math.max(verified - paid, 0);
      outstandingHours += outstanding;
      if (mem.hourlyRate != null) outstandingAmount += outstanding * Number(mem.hourlyRate);
    }

    const payroll = {
      outstandingHours: round2(outstandingHours),
      outstandingAmount: round2(outstandingAmount),
    };

    // ── active sites ─────────────────────────────────────────────────────
    const allSiteRows = await db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(eq(locations.active, true))
      .orderBy(asc(locations.sortOrder), asc(locations.name));

    // Every query below keys off `siteRows`, so scoping here scopes it all.
    const siteRows = data?.locationId
      ? allSiteRows.filter((s) => s.id === data.locationId)
      : allSiteRows;

    if (siteRows.length === 0) {
      return {
        month,
        allSites: allSiteRows,
        sites: [],
        totals: emptyTotals,
        bestDay: null,
        worstDay: null,
        weekly: [],
        payroll,
      };
    }

    const siteIds = siteRows.map((s) => s.id);
    const siteNameById = new Map(siteRows.map((s) => [s.id, s.name]));

    // ── sales for the month, every site in one query ────────────────────
    const salesRows = await db
      .select({
        date: salesEntries.date,
        locationId: salesEntries.locationId,
        uber: salesEntries.uber,
        takeaway: salesEntries.takeaway,
        dineIn: salesEntries.dineIn,
      })
      .from(salesEntries)
      .where(
        and(
          inArray(salesEntries.locationId, siteIds),
          gte(salesEntries.date, monthStart),
          lte(salesEntries.date, monthEnd),
        ),
      );

    const salesBySite = new Map<string, SalesTotals & { total: number }>();
    for (const id of siteIds) {
      salesBySite.set(id, {
        total: 0,
        uber: 0,
        takeaway: 0,
        dineIn: 0,
        daysLogged: 0,
        avgPerDay: 0,
      });
    }

    const dailyTotalByDate = new Map<string, number>();
    let bestDay: { date: string; siteName: string; total: number } | null = null;
    let worstDay: { date: string; siteName: string; total: number } | null = null;

    for (const r of salesRows) {
      const uber = Number(r.uber);
      const takeaway = Number(r.takeaway);
      const dineIn = Number(r.dineIn);
      const total = uber + takeaway + dineIn;

      const bucket = salesBySite.get(r.locationId);
      if (bucket) {
        bucket.uber += uber;
        bucket.takeaway += takeaway;
        bucket.dineIn += dineIn;
        bucket.total += total;
        bucket.daysLogged += 1;
      }

      dailyTotalByDate.set(r.date, (dailyTotalByDate.get(r.date) ?? 0) + total);

      const siteName = siteNameById.get(r.locationId) ?? "Unknown";
      if (!bestDay || total > bestDay.total) bestDay = { date: r.date, siteName, total };
      if (!worstDay || total < worstDay.total) worstDay = { date: r.date, siteName, total };
    }

    // ── weekly trend: daily totals (across sites) bucketed into ISO weeks ─
    const weeklyBuckets = new Map<string, { year: number; week: number; total: number }>();
    for (const [date, total] of dailyTotalByDate) {
      const { year, week } = isoWeekInfo(date);
      const key = `${year}-${week}`;
      const bucket = weeklyBuckets.get(key);
      if (bucket) bucket.total += total;
      else weeklyBuckets.set(key, { year, week, total });
    }
    const weekly = [...weeklyBuckets.values()]
      .sort((a, b) => a.year - b.year || a.week - b.week)
      .map((b) => ({ weekLabel: `Wk ${b.week}`, total: round2(b.total) }));

    // ── hours + labour cost for the month, every site in one query ──────
    const shiftRows = await db
      .select({
        locationId: shifts.locationId,
        clockInAt: shifts.clockInAt,
        clockOutAt: shifts.clockOutAt,
        status: shifts.status,
        hourlyRate: members.hourlyRate,
      })
      .from(shifts)
      .innerJoin(members, eq(shifts.memberId, members.id))
      .where(
        and(
          inArray(shifts.locationId, siteIds),
          isNotNull(shifts.clockOutAt),
          inArray(shifts.status, ["verified", "pending"]),
          gte(shifts.clockOutAt, paddedStart),
          lt(shifts.clockOutAt, paddedEnd),
        ),
      );

    const hoursBySite = new Map<
      string,
      { verified: number; pending: number; labourCost: number }
    >();
    for (const id of siteIds) hoursBySite.set(id, { verified: 0, pending: 0, labourCost: 0 });

    for (const r of shiftRows) {
      if (!r.clockOutAt || !inTargetMonth(new Date(r.clockOutAt))) continue;
      const bucket = hoursBySite.get(r.locationId);
      if (!bucket) continue;
      const hrs = shiftHours(r.clockInAt, r.clockOutAt) ?? 0;
      if (r.status === "verified") {
        bucket.verified += hrs;
        bucket.labourCost += hrs * (r.hourlyRate != null ? Number(r.hourlyRate) : 0);
      } else if (r.status === "pending") {
        bucket.pending += hrs;
      }
    }

    // ── stock orders for the month, every site in one query ─────────────
    const orderRows = await db
      .select({
        id: stockOrders.id,
        locationId: stockOrders.locationId,
        status: stockOrders.status,
        placedAt: stockOrders.placedAt,
      })
      .from(stockOrders)
      .where(
        and(
          inArray(stockOrders.locationId, siteIds),
          gte(stockOrders.placedAt, paddedStart),
          lt(stockOrders.placedAt, paddedEnd),
        ),
      );

    const ordersInMonth = orderRows.filter((o) => inTargetMonth(new Date(o.placedAt)));
    const orderIds = ordersInMonth.map((o) => o.id);
    const orderIdToLocation = new Map(ordersInMonth.map((o) => [o.id, o.locationId]));

    const orderItemRows = orderIds.length
      ? await db
          .select({
            orderId: stockOrderItems.orderId,
            quantityOrdered: stockOrderItems.quantityOrdered,
            quantitySent: stockOrderItems.quantitySent,
          })
          .from(stockOrderItems)
          .where(inArray(stockOrderItems.orderId, orderIds))
      : [];

    const ordersBySite = new Map<
      string,
      { placed: number; received: number; shortfallItems: number }
    >();
    for (const id of siteIds) ordersBySite.set(id, { placed: 0, received: 0, shortfallItems: 0 });

    for (const o of ordersInMonth) {
      const bucket = ordersBySite.get(o.locationId);
      if (!bucket) continue;
      bucket.placed += 1;
      if (o.status === "received") bucket.received += 1;
    }
    for (const item of orderItemRows) {
      const locationId = orderIdToLocation.get(item.orderId);
      const bucket = locationId ? ordersBySite.get(locationId) : undefined;
      if (!bucket) continue;
      if (item.quantitySent != null && Number(item.quantitySent) < Number(item.quantityOrdered)) {
        bucket.shortfallItems += 1;
      }
    }

    // ── assemble per-site + totals ───────────────────────────────────────
    const sites: SiteInsight[] = siteRows.map((s) => {
      const salesRaw = salesBySite.get(s.id)!;
      const hoursRaw = hoursBySite.get(s.id)!;
      const ordersRaw = ordersBySite.get(s.id)!;
      const avgPerDay = salesRaw.daysLogged > 0 ? salesRaw.total / salesRaw.daysLogged : 0;
      const labourPct = salesRaw.total > 0 ? hoursRaw.labourCost / salesRaw.total : null;
      return {
        id: s.id,
        name: s.name,
        sales: {
          total: round2(salesRaw.total),
          uber: round2(salesRaw.uber),
          takeaway: round2(salesRaw.takeaway),
          dineIn: round2(salesRaw.dineIn),
          daysLogged: salesRaw.daysLogged,
          avgPerDay: round2(avgPerDay),
        },
        hours: { verified: round2(hoursRaw.verified), pending: round2(hoursRaw.pending) },
        labourCost: round2(hoursRaw.labourCost),
        labourPct: labourPct !== null ? Math.round(labourPct * 10000) / 10000 : null,
        orders: { ...ordersRaw },
      };
    });

    const totalsRaw = siteIds.reduce(
      (acc, id) => {
        const sr = salesBySite.get(id)!;
        const hr = hoursBySite.get(id)!;
        const or = ordersBySite.get(id)!;
        acc.total += sr.total;
        acc.uber += sr.uber;
        acc.takeaway += sr.takeaway;
        acc.dineIn += sr.dineIn;
        acc.daysLogged += sr.daysLogged;
        acc.verified += hr.verified;
        acc.pending += hr.pending;
        acc.labourCost += hr.labourCost;
        acc.placed += or.placed;
        acc.received += or.received;
        acc.shortfallItems += or.shortfallItems;
        return acc;
      },
      {
        total: 0,
        uber: 0,
        takeaway: 0,
        dineIn: 0,
        daysLogged: 0,
        verified: 0,
        pending: 0,
        labourCost: 0,
        placed: 0,
        received: 0,
        shortfallItems: 0,
      },
    );

    const totalAvgPerDay = totalsRaw.daysLogged > 0 ? totalsRaw.total / totalsRaw.daysLogged : 0;
    const totalLabourPct = totalsRaw.total > 0 ? totalsRaw.labourCost / totalsRaw.total : null;

    const totals: Totals = {
      sales: {
        total: round2(totalsRaw.total),
        uber: round2(totalsRaw.uber),
        takeaway: round2(totalsRaw.takeaway),
        dineIn: round2(totalsRaw.dineIn),
        daysLogged: totalsRaw.daysLogged,
        avgPerDay: round2(totalAvgPerDay),
      },
      hours: { verified: round2(totalsRaw.verified), pending: round2(totalsRaw.pending) },
      labourCost: round2(totalsRaw.labourCost),
      labourPct: totalLabourPct !== null ? Math.round(totalLabourPct * 10000) / 10000 : null,
      orders: {
        placed: totalsRaw.placed,
        received: totalsRaw.received,
        shortfallItems: totalsRaw.shortfallItems,
      },
    };

    return { month, allSites: allSiteRows, sites, totals, bestDay, worstDay, weekly, payroll };
  });
