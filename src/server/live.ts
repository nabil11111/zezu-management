import { createServerFn } from "@tanstack/react-start";

/**
 * The Live View — the home screen. A little living picture of ZEZU right
 * now: every accessible site as a card, whether it's open (and who opened
 * it), who's clocked in this minute, today's takings so far, and any stock
 * flags. Built from a handful of grouped queries (`inArray` on the location
 * ids resolved for this actor), not a per-site query loop.
 */

export interface LiveViewShopDay {
  openedAt: string;
  openedByName: string;
  closedAt: string | null;
}

export interface LiveViewClockedInMember {
  memberId: string;
  name: string;
  role: string;
  clockInAt: string;
  status: string;
}

export interface LiveViewSales {
  uber: number;
  takeaway: number;
  dineIn: number;
  total: number;
}

export interface LiveViewSite {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  shopDay: LiveViewShopDay | null;
  status: "open" | "closed" | "not_opened";
  clockedIn: LiveViewClockedInMember[];
  pendingVerifications: number;
  todaySales: LiveViewSales | null;
  yesterdaySales: { total: number } | null;
  lowStock: number;
}

export interface LiveViewResult {
  generatedAt: string;
  sites: LiveViewSite[];
  totals: {
    todayTotal: number;
    monthTotal: number;
    clockedInCount: number;
    lowStockCount: number;
    pendingCount: number;
  };
}

function emptyResult(): LiveViewResult {
  return {
    generatedAt: new Date().toISOString(),
    sites: [],
    totals: { todayTotal: 0, monthTotal: 0, clockedInCount: 0, lowStockCount: 0, pendingCount: 0 },
  };
}

/** Manager-gated: the live state of every accessible active location, right now. */
export const getLiveView = createServerFn({ method: "GET" }).handler(
  async (): Promise<LiveViewResult> => {
    const { requireManager } = await import("@/lib/auth.server");
    const { db, locations, shopDays, shifts, members, salesEntries, stockItems } =
      await import("@/db");
    const { and, asc, eq, gte, inArray, isNull, isNotNull, sql } = await import("drizzle-orm");
    const { todayDateString } = await import("@/server/types");

    const { locationIds } = await requireManager();

    const today = todayDateString();
    const yesterday = todayDateString(-1);
    const monthStart = `${today.slice(0, 7)}-01`;

    const siteRows = await db
      .select({
        id: locations.id,
        name: locations.name,
        slug: locations.slug,
        address: locations.address,
      })
      .from(locations)
      .where(
        and(
          eq(locations.active, true),
          locationIds === "all" ? undefined : inArray(locations.id, locationIds),
        ),
      )
      .orderBy(asc(locations.sortOrder));

    const ids = siteRows.map((s) => s.id);
    if (ids.length === 0) return emptyResult();

    const [
      shopDayRows,
      clockedInRows,
      pendingRows,
      todaySalesRows,
      yesterdaySalesRows,
      stockRows,
      monthSalesRows,
    ] = await Promise.all([
      // Today's shop-day row per location (at most one, per the unique index).
      db
        .select({
          locationId: shopDays.locationId,
          openedAt: shopDays.openedAt,
          closedAt: shopDays.closedAt,
          openerName: members.name,
        })
        .from(shopDays)
        .innerJoin(members, eq(shopDays.openedBy, members.id))
        .where(and(inArray(shopDays.locationId, ids), eq(shopDays.date, today))),

      // Anyone currently clocked in (no clock-out yet) at these locations.
      db
        .select({
          locationId: shifts.locationId,
          memberId: shifts.memberId,
          name: members.name,
          role: members.role,
          clockInAt: shifts.clockInAt,
          status: shifts.status,
        })
        .from(shifts)
        .innerJoin(members, eq(shifts.memberId, members.id))
        .where(and(inArray(shifts.locationId, ids), isNull(shifts.clockOutAt)))
        .orderBy(asc(shifts.clockInAt)),

      // Clocked-out shifts still awaiting manager verification.
      db
        .select({ locationId: shifts.locationId })
        .from(shifts)
        .where(
          and(
            inArray(shifts.locationId, ids),
            eq(shifts.status, "pending"),
            isNotNull(shifts.clockOutAt),
          ),
        ),

      db
        .select({
          locationId: salesEntries.locationId,
          uber: salesEntries.uber,
          takeaway: salesEntries.takeaway,
          dineIn: salesEntries.dineIn,
        })
        .from(salesEntries)
        .where(and(inArray(salesEntries.locationId, ids), eq(salesEntries.date, today))),

      db
        .select({
          locationId: salesEntries.locationId,
          uber: salesEntries.uber,
          takeaway: salesEntries.takeaway,
          dineIn: salesEntries.dineIn,
        })
        .from(salesEntries)
        .where(and(inArray(salesEntries.locationId, ids), eq(salesEntries.date, yesterday))),

      // Active stock items — low-stock threshold check happens in JS below
      // since `level`/`lowThreshold` are numeric strings.
      db
        .select({
          locationId: stockItems.locationId,
          level: stockItems.level,
          lowThreshold: stockItems.lowThreshold,
        })
        .from(stockItems)
        .where(and(inArray(stockItems.locationId, ids), eq(stockItems.active, true))),

      // Month-to-date takings across the accessible sites — one number.
      db
        .select({
          total: sql<string>`coalesce(sum(${salesEntries.uber} + ${salesEntries.takeaway} + ${salesEntries.dineIn}), 0)`,
        })
        .from(salesEntries)
        .where(and(inArray(salesEntries.locationId, ids), gte(salesEntries.date, monthStart))),
    ]);

    const monthTotal = Number(monthSalesRows[0]?.total ?? 0);

    const shopDayByLocation = new Map<string, (typeof shopDayRows)[number]>();
    for (const row of shopDayRows) shopDayByLocation.set(row.locationId, row);

    const clockedInByLocation = new Map<string, LiveViewClockedInMember[]>();
    for (const row of clockedInRows) {
      const list = clockedInByLocation.get(row.locationId) ?? [];
      list.push({
        memberId: row.memberId,
        name: row.name,
        role: row.role,
        clockInAt: row.clockInAt.toISOString(),
        status: row.status,
      });
      clockedInByLocation.set(row.locationId, list);
    }

    const pendingByLocation = new Map<string, number>();
    for (const row of pendingRows) {
      pendingByLocation.set(row.locationId, (pendingByLocation.get(row.locationId) ?? 0) + 1);
    }

    const todaySalesByLocation = new Map<string, LiveViewSales>();
    for (const row of todaySalesRows) {
      const uber = Number(row.uber);
      const takeaway = Number(row.takeaway);
      const dineIn = Number(row.dineIn);
      todaySalesByLocation.set(row.locationId, {
        uber,
        takeaway,
        dineIn,
        total: uber + takeaway + dineIn,
      });
    }

    const yesterdaySalesByLocation = new Map<string, { total: number }>();
    for (const row of yesterdaySalesRows) {
      const total = Number(row.uber) + Number(row.takeaway) + Number(row.dineIn);
      yesterdaySalesByLocation.set(row.locationId, { total });
    }

    const lowStockByLocation = new Map<string, number>();
    for (const row of stockRows) {
      if (row.lowThreshold == null) continue;
      if (Number(row.level) > Number(row.lowThreshold)) continue;
      lowStockByLocation.set(row.locationId, (lowStockByLocation.get(row.locationId) ?? 0) + 1);
    }

    let todayTotal = 0;
    let clockedInCount = 0;
    let lowStockCount = 0;
    let pendingCount = 0;

    const sites: LiveViewSite[] = siteRows.map((site) => {
      const shopDayRow = shopDayByLocation.get(site.id) ?? null;
      const status: LiveViewSite["status"] = !shopDayRow
        ? "not_opened"
        : shopDayRow.closedAt
          ? "closed"
          : "open";

      const clockedIn = clockedInByLocation.get(site.id) ?? [];
      const pendingVerifications = pendingByLocation.get(site.id) ?? 0;
      const todaySales = todaySalesByLocation.get(site.id) ?? null;
      const yesterdaySales = yesterdaySalesByLocation.get(site.id) ?? null;
      const lowStock = lowStockByLocation.get(site.id) ?? 0;

      todayTotal += todaySales?.total ?? 0;
      clockedInCount += clockedIn.length;
      lowStockCount += lowStock;
      pendingCount += pendingVerifications;

      return {
        id: site.id,
        name: site.name,
        slug: site.slug,
        address: site.address,
        shopDay: shopDayRow
          ? {
              openedAt: shopDayRow.openedAt.toISOString(),
              openedByName: shopDayRow.openerName,
              closedAt: shopDayRow.closedAt ? shopDayRow.closedAt.toISOString() : null,
            }
          : null,
        status,
        clockedIn,
        pendingVerifications,
        todaySales,
        yesterdaySales,
        lowStock,
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      sites,
      totals: { todayTotal, monthTotal, clockedInCount, lowStockCount, pendingCount },
    };
  },
);
