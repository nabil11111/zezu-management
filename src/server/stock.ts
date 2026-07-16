import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { logActivity } from "@/server/activity";
import { stockMoveKindSchema, todayDateString } from "@/server/types";

/**
 * Stock: per-location items with a running `level`, a ledger of moves
 * (`usage` out / `delivery` in / `adjustment` signed correction), and the
 * "know tonight what you'll run out of tomorrow" overview that turns low
 * items into a ready-to-send order list per supplier.
 *
 * `level` is denormalised onto stock_items for fast reads. Every move
 * updates it atomically (SQL increment, inside a transaction with the move
 * insert) so it never drifts from the ledger.
 *
 * Levels are allowed to go negative — that's real drift (someone forgot to
 * log a delivery, a count was off) and it surfaces itself: a negative level
 * is always <= any low threshold, so it shows up in "running low" and the
 * order list rather than being silently floored.
 */

/** Rounds a suggested order quantity to a sane display precision (nearest 0.25). */
function roundQty(n: number): number {
  return Math.round(n * 4) / 4;
}

/** Fetches a stock item's locationId (for access checks) or throws if missing. */
async function getItemLocationId(id: string): Promise<string> {
  const { db, stockItems } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const row = await db.query.stockItems.findFirst({
    where: eq(stockItems.id, id),
    columns: { locationId: true },
  });
  if (!row) throw new Error("Stock item not found");
  return row.locationId;
}

/**
 * The overview is shared ground between "just log usage" staff and
 * "manage the catalog" staff — pass if either capability is held (or CEO/
 * assigned manager), so viewing levels never requires both.
 */
async function requireStockAccess(locationId: string) {
  const { requireAuth, getActorLocationIds, assertLocationAccess, getActorCapabilities } =
    await import("@/lib/auth.server");
  const actor = await requireAuth();
  if (actor.role === "ceo") return actor;

  const locationIds = await getActorLocationIds(actor);
  assertLocationAccess(locationIds, locationId);

  const caps = await getActorCapabilities(actor);
  if (!caps.includes("log_usage") && !caps.includes("manage_stock")) {
    throw new Error("Not allowed");
  }
  return actor;
}

// ── overview ─────────────────────────────────────────────────────────────

export const getStockOverview = createServerFn({ method: "GET" })
  .validator(z.object({ locationId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireStockAccess(data.locationId);

    const { db, stockItems, stockMoves, members } = await import("@/db");
    const { eq, asc, desc } = await import("drizzle-orm");

    const itemRows = await db
      .select()
      .from(stockItems)
      .where(eq(stockItems.locationId, data.locationId))
      .orderBy(asc(stockItems.sortOrder), asc(stockItems.name));

    const items = itemRows.map((r) => {
      const level = Number(r.level);
      const lowThreshold = r.lowThreshold != null ? Number(r.lowThreshold) : null;
      return {
        id: r.id,
        name: r.name,
        unit: r.unit,
        level,
        lowThreshold,
        supplier: r.supplier,
        active: r.active,
        isLow: lowThreshold != null && level <= lowThreshold,
        sortOrder: r.sortOrder,
      };
    });

    const moveRows = await db
      .select({
        id: stockMoves.id,
        itemName: stockItems.name,
        unit: stockItems.unit,
        kind: stockMoves.kind,
        quantity: stockMoves.quantity,
        date: stockMoves.date,
        note: stockMoves.note,
        byName: members.name,
        createdAt: stockMoves.createdAt,
      })
      .from(stockMoves)
      .innerJoin(stockItems, eq(stockMoves.stockItemId, stockItems.id))
      .leftJoin(members, eq(stockMoves.byMemberId, members.id))
      .where(eq(stockItems.locationId, data.locationId))
      .orderBy(desc(stockMoves.createdAt))
      .limit(30);

    const recentMoves = moveRows.map((m) => ({
      id: m.id,
      itemName: m.itemName,
      unit: m.unit,
      kind: m.kind as "usage" | "delivery" | "adjustment",
      quantity: Number(m.quantity),
      date: m.date,
      note: m.note,
      byName: m.byName,
      createdAt: m.createdAt,
    }));

    // ── order list: low, active items grouped by supplier ──────────────
    type OrderLine = {
      name: string;
      unit: string;
      level: number;
      lowThreshold: number;
      suggestedQty: number;
    };
    const groups = new Map<string, OrderLine[]>();
    for (const item of items) {
      if (!item.active || !item.isLow || item.lowThreshold == null) continue;
      const key = item.supplier ?? "Unassigned";
      const suggestedQty = roundQty(Math.max(item.lowThreshold * 2 - item.level, 0));
      const list = groups.get(key) ?? [];
      list.push({
        name: item.name,
        unit: item.unit,
        level: item.level,
        lowThreshold: item.lowThreshold,
        suggestedQty,
      });
      groups.set(key, list);
    }

    const orderList = [...groups.entries()]
      .sort(([a], [b]) => {
        if (a === "Unassigned") return 1;
        if (b === "Unassigned") return -1;
        return a.localeCompare(b);
      })
      .map(([supplier, groupItems]) => ({ supplier, items: groupItems }));

    return { items, recentMoves, orderList };
  });

// ── item CRUD ────────────────────────────────────────────────────────────

export const createStockItem = createServerFn({ method: "POST" })
  .validator(
    z.object({
      locationId: z.string().uuid(),
      name: z.string().min(1),
      unit: z.string().min(1),
      lowThreshold: z.number().nonnegative().optional().nullable(),
      supplier: z.string().optional().nullable(),
      initialLevel: z.number().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { requireCapabilityAtLocation } = await import("@/lib/auth.server");
    const actor = await requireCapabilityAtLocation("manage_stock", data.locationId);

    const { db, stockItems, stockMoves } = await import("@/db");
    const { sql } = await import("drizzle-orm");

    const initialLevel = data.initialLevel ?? 0;

    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(stockItems)
        .values({
          locationId: data.locationId,
          name: data.name,
          unit: data.unit,
          level: String(initialLevel),
          lowThreshold: data.lowThreshold != null ? String(data.lowThreshold) : null,
          supplier: data.supplier ?? null,
          sortOrder: sql`(select coalesce(max(sort_order), -1) + 1 from stock_items where location_id = ${data.locationId})`,
        })
        .returning();

      if (initialLevel > 0) {
        await tx.insert(stockMoves).values({
          stockItemId: inserted.id,
          date: todayDateString(),
          kind: "adjustment",
          quantity: String(initialLevel),
          note: "Opening level",
          byMemberId: actor.memberId,
        });
      }

      return inserted;
    });

    await logActivity("stock_item", row.id, "created", {
      name: row.name,
      unit: row.unit,
      lowThreshold: data.lowThreshold ?? null,
      supplier: data.supplier ?? null,
      initialLevel,
    });

    return {
      ...row,
      level: Number(row.level),
      lowThreshold: row.lowThreshold != null ? Number(row.lowThreshold) : null,
    };
  });

export const updateStockItem = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().uuid(),
      patch: z.object({
        name: z.string().min(1).optional(),
        unit: z.string().min(1).optional(),
        lowThreshold: z.number().nonnegative().nullable().optional(),
        supplier: z.string().nullable().optional(),
        sortOrder: z.number().int().optional(),
      }),
    }),
  )
  .handler(async ({ data }) => {
    const { requireCapabilityAtLocation } = await import("@/lib/auth.server");
    const locationId = await getItemLocationId(data.id);
    await requireCapabilityAtLocation("manage_stock", locationId);

    const { db, stockItems } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const { lowThreshold, ...rest } = data.patch;
    const [row] = await db
      .update(stockItems)
      .set({
        ...rest,
        ...(lowThreshold !== undefined
          ? { lowThreshold: lowThreshold != null ? String(lowThreshold) : null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(stockItems.id, data.id))
      .returning();

    await logActivity("stock_item", data.id, "updated", data.patch);

    return {
      ...row,
      level: Number(row.level),
      lowThreshold: row.lowThreshold != null ? Number(row.lowThreshold) : null,
    };
  });

export const setStockItemActive = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), active: z.boolean() }))
  .handler(async ({ data }) => {
    const { requireCapabilityAtLocation } = await import("@/lib/auth.server");
    const locationId = await getItemLocationId(data.id);
    await requireCapabilityAtLocation("manage_stock", locationId);

    const { db, stockItems } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const [row] = await db
      .update(stockItems)
      .set({ active: data.active, updatedAt: new Date() })
      .where(eq(stockItems.id, data.id))
      .returning();

    await logActivity("stock_item", data.id, data.active ? "activated" : "deactivated");

    return {
      ...row,
      level: Number(row.level),
      lowThreshold: row.lowThreshold != null ? Number(row.lowThreshold) : null,
    };
  });

// ── moves ────────────────────────────────────────────────────────────────

export const logMove = createServerFn({ method: "POST" })
  .validator(
    z.object({
      stockItemId: z.string().uuid(),
      kind: stockMoveKindSchema,
      quantity: z.number().refine((n) => n !== 0, "Quantity can't be zero"),
      note: z.string().optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    if (data.kind !== "adjustment" && data.quantity < 0) {
      throw new Error("Quantity must be positive for usage and delivery");
    }

    const { requireCapabilityAtLocation } = await import("@/lib/auth.server");
    const locationId = await getItemLocationId(data.stockItemId);
    const actor = await requireCapabilityAtLocation("log_usage", locationId);

    const { db, stockItems, stockMoves } = await import("@/db");
    const { eq, sql } = await import("drizzle-orm");

    // usage subtracts, delivery adds, adjustment applies the signed input directly.
    const delta = data.kind === "usage" ? -data.quantity : data.quantity;

    const newLevel = await db.transaction(async (tx) => {
      await tx.insert(stockMoves).values({
        stockItemId: data.stockItemId,
        date: todayDateString(),
        kind: data.kind,
        quantity: String(data.quantity),
        note: data.note ?? null,
        byMemberId: actor.memberId,
      });

      const [updated] = await tx
        .update(stockItems)
        .set({ level: sql`${stockItems.level} + ${delta}`, updatedAt: new Date() })
        .where(eq(stockItems.id, data.stockItemId))
        .returning({ level: stockItems.level });

      return Number(updated.level);
    });

    await logActivity("stock_move", data.stockItemId, data.kind, {
      quantity: data.quantity,
      note: data.note ?? null,
      newLevel,
    });

    return { level: newLevel };
  });

export const logDayUsage = createServerFn({ method: "POST" })
  .validator(
    z.object({
      locationId: z.string().uuid(),
      entries: z.array(
        z.object({
          stockItemId: z.string().uuid(),
          quantity: z.number(),
        }),
      ),
    }),
  )
  .handler(async ({ data }) => {
    const { requireCapabilityAtLocation } = await import("@/lib/auth.server");
    const actor = await requireCapabilityAtLocation("log_usage", data.locationId);

    const entries = data.entries.filter((e) => e.quantity > 0);
    if (entries.length === 0) return { logged: 0 };

    const { db, stockItems, stockMoves } = await import("@/db");
    const { eq, and, inArray, sql } = await import("drizzle-orm");

    // Guard: only apply moves for items that actually belong to this location.
    const owned = await db
      .select({ id: stockItems.id })
      .from(stockItems)
      .where(
        and(
          eq(stockItems.locationId, data.locationId),
          inArray(
            stockItems.id,
            entries.map((e) => e.stockItemId),
          ),
        ),
      );
    const ownedIds = new Set(owned.map((o) => o.id));
    const valid = entries.filter((e) => ownedIds.has(e.stockItemId));

    await db.transaction(async (tx) => {
      for (const entry of valid) {
        await tx.insert(stockMoves).values({
          stockItemId: entry.stockItemId,
          date: todayDateString(),
          kind: "usage",
          quantity: String(entry.quantity),
          note: null,
          byMemberId: actor.memberId,
        });

        await tx
          .update(stockItems)
          .set({ level: sql`${stockItems.level} - ${entry.quantity}`, updatedAt: new Date() })
          .where(eq(stockItems.id, entry.stockItemId));
      }
    });

    await logActivity("stock_move", data.locationId, "day_usage_logged", {
      count: valid.length,
      entries: valid,
    });

    return { logged: valid.length };
  });
