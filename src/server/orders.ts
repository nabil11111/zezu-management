import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { logActivity } from "@/server/activity";
import { orderStatusSchema, todayDateString, type OrderStatus } from "@/server/types";

/**
 * Stock orders: branch → warehouse → branch verification, constrained to the
 * warehouse's own catalog (`warehouseProducts` — see @/server/warehouse). A
 * branch employee places the day's order against whatever's currently
 * available in that catalog; the warehouse sees it, packs it — possibly
 * adjusting quantities if they're short — and marks it sent (`sent`). The
 * branch employee then counts what actually came off the van and confirms
 * receipt (`received`); THAT step is what writes `delivery` stock_moves and
 * bumps stock_items.level, so levels always reflect what was RECEIVED, never
 * what was promised.
 *
 * If something arrives short (warehouse sent less than ordered) or missing
 * off the van (branch received less than sent), the order has a SHORTFALL.
 * The branch (or the warehouse) can log why, and either side can mark it
 * resolved once it's settled — that's the issueReason / issueResolvedAt /
 * issueResolvedBy trail on stock_orders.
 *
 * Only createServerFn + zod + the plain-TS helpers from @/server/types are
 * statically imported here — db, auth.server, and drizzle-orm are reached
 * via dynamic `import()` inside each handler so this file stays safe to
 * import from client-rendered routes.
 */

/** Either the branch (any location member) or the warehouse/CEO may act on
 * an order's delivery-issue trail — whoever notices the shortfall first. */
async function requireOrderIssueActor(locationId: string) {
  const { requireLocationMember, requireWarehouse } = await import("@/lib/auth.server");
  try {
    return await requireLocationMember(locationId);
  } catch {
    return await requireWarehouse();
  }
}

// ── branch: the order board ─────────────────────────────────────────────

export const getOrderBoard = createServerFn({ method: "GET" })
  .validator(z.object({ locationId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { requireLocationMember } = await import("@/lib/auth.server");
    await requireLocationMember(data.locationId);

    const { db, warehouseProducts, stockItems, stockOrders, stockOrderItems, members } =
      await import("@/db");
    const { eq, and, asc, desc, inArray } = await import("drizzle-orm");

    const catalog = await db
      .select({
        id: warehouseProducts.id,
        name: warehouseProducts.name,
        unit: warehouseProducts.unit,
        supplier: warehouseProducts.supplier,
      })
      .from(warehouseProducts)
      .where(and(eq(warehouseProducts.available, true), eq(warehouseProducts.active, true)))
      .orderBy(asc(warehouseProducts.sortOrder), asc(warehouseProducts.name));

    const orderRows = await db.query.stockOrders.findMany({
      where: eq(stockOrders.locationId, data.locationId),
      orderBy: [desc(stockOrders.placedAt)],
      limit: 30,
    });

    const orderIds = orderRows.map((o) => o.id);
    const orderItemRows = orderIds.length
      ? await db
          .select({
            id: stockOrderItems.id,
            orderId: stockOrderItems.orderId,
            stockItemId: stockOrderItems.stockItemId,
            warehouseProductId: stockOrderItems.warehouseProductId,
            quantityOrdered: stockOrderItems.quantityOrdered,
            quantitySent: stockOrderItems.quantitySent,
            quantityReceived: stockOrderItems.quantityReceived,
            loaded: stockOrderItems.loaded,
            unloaded: stockOrderItems.unloaded,
            itemName: stockItems.name,
            itemUnit: stockItems.unit,
          })
          .from(stockOrderItems)
          .innerJoin(stockItems, eq(stockOrderItems.stockItemId, stockItems.id))
          .where(inArray(stockOrderItems.orderId, orderIds))
      : [];

    const memberIds = Array.from(
      new Set(
        orderRows.flatMap((o) =>
          [o.placedBy, o.sentBy, o.receivedBy, o.issueResolvedBy].filter((x): x is string =>
            Boolean(x),
          ),
        ),
      ),
    );
    const memberRows = memberIds.length
      ? await db.query.members.findMany({ where: inArray(members.id, memberIds) })
      : [];
    const memberName = new Map(memberRows.map((m) => [m.id, m.name]));

    const orders = orderRows.map((o) => ({
      id: o.id,
      status: o.status as OrderStatus,
      note: o.note,
      sentNote: o.sentNote,
      placedAt: o.placedAt.toISOString(),
      placedByName: memberName.get(o.placedBy) ?? "Unknown",
      sentAt: o.sentAt ? o.sentAt.toISOString() : null,
      sentByName: o.sentBy ? (memberName.get(o.sentBy) ?? "Unknown") : null,
      receivedAt: o.receivedAt ? o.receivedAt.toISOString() : null,
      receivedByName: o.receivedBy ? (memberName.get(o.receivedBy) ?? "Unknown") : null,
      issueReason: o.issueReason,
      issueResolvedAt: o.issueResolvedAt ? o.issueResolvedAt.toISOString() : null,
      issueResolvedByName: o.issueResolvedBy
        ? (memberName.get(o.issueResolvedBy) ?? "Unknown")
        : null,
      items: orderItemRows
        .filter((it) => it.orderId === o.id)
        .map((it) => ({
          orderItemId: it.id,
          stockItemId: it.stockItemId,
          warehouseProductId: it.warehouseProductId,
          name: it.itemName,
          unit: it.itemUnit,
          quantityOrdered: Number(it.quantityOrdered),
          quantitySent: it.quantitySent != null ? Number(it.quantitySent) : null,
          quantityReceived: it.quantityReceived != null ? Number(it.quantityReceived) : null,
          loaded: it.loaded,
          unloaded: it.unloaded,
        })),
    }));

    return { catalog, orders };
  });

/**
 * Branch employee places today's order — constrained to whatever's currently
 * available in the warehouse catalog. Each line resolves to (or creates) the
 * matching branch stock_item by (name, unit), so the branch's own stock list
 * grows to match what it actually orders in.
 */
export const placeOrder = createServerFn({ method: "POST" })
  .validator(
    z.object({
      locationId: z.string().uuid(),
      note: z.string().trim().optional(),
      items: z
        .array(
          z.object({
            warehouseProductId: z.string().uuid(),
            quantity: z.number().positive(),
          }),
        )
        .min(1, "Add at least one item"),
    }),
  )
  .handler(async ({ data }) => {
    const { requireCapabilityAtLocation } = await import("@/lib/auth.server");
    const actor = await requireCapabilityAtLocation("place_orders", data.locationId);

    const { db, warehouseProducts, stockItems, stockOrders, stockOrderItems, locations } =
      await import("@/db");
    const { eq, and, inArray, sql } = await import("drizzle-orm");

    const requestedIds = data.items.map((i) => i.warehouseProductId);
    const products = await db
      .select()
      .from(warehouseProducts)
      .where(inArray(warehouseProducts.id, requestedIds));
    const productById = new Map(products.map((p) => [p.id, p]));

    for (const item of data.items) {
      const product = productById.get(item.warehouseProductId);
      if (!product || !product.available || !product.active) {
        throw new Error("One or more items are no longer available from the warehouse");
      }
    }

    const order = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(stockOrders)
        .values({
          locationId: data.locationId,
          status: "placed",
          note: data.note?.trim() || null,
          placedBy: actor.memberId,
        })
        .returning();

      for (const item of data.items) {
        const product = productById.get(item.warehouseProductId)!;

        // Find (or create) the branch stock line this catalog product maps to.
        const [existing] = await tx
          .select({ id: stockItems.id })
          .from(stockItems)
          .where(
            and(
              eq(stockItems.locationId, data.locationId),
              eq(stockItems.name, product.name),
              eq(stockItems.unit, product.unit),
            ),
          )
          .limit(1);

        let stockItemId = existing?.id;
        if (!stockItemId) {
          const [created] = await tx
            .insert(stockItems)
            .values({
              locationId: data.locationId,
              name: product.name,
              unit: product.unit,
              level: "0",
              supplier: product.supplier,
              active: true,
              sortOrder: sql`(select coalesce(max(sort_order), -1) + 1 from stock_items where location_id = ${data.locationId})`,
            })
            .returning({ id: stockItems.id });
          stockItemId = created.id;
        }

        await tx.insert(stockOrderItems).values({
          orderId: inserted.id,
          stockItemId,
          warehouseProductId: product.id,
          quantityOrdered: String(item.quantity),
        });
      }

      return inserted;
    });

    const location = await db.query.locations.findFirst({
      where: eq(locations.id, data.locationId),
    });

    await logActivity("stock_order", order.id, "placed", {
      locationName: location?.name ?? "Unknown",
      items: data.items.length,
    });

    return { id: order.id };
  });

/** Branch employee cancels an order that hasn't gone out yet. */
export const cancelOrder = createServerFn({ method: "POST" })
  .validator(z.object({ orderId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { db, stockOrders, locations } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const order = await db.query.stockOrders.findFirst({ where: eq(stockOrders.id, data.orderId) });
    if (!order) throw new Error("Order not found");

    const { requireLocationMember } = await import("@/lib/auth.server");
    await requireLocationMember(order.locationId);

    if (order.status !== "placed") throw new Error("Already on the van");

    await db
      .update(stockOrders)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(stockOrders.id, data.orderId));

    const location = await db.query.locations.findFirst({
      where: eq(locations.id, order.locationId),
    });

    await logActivity("stock_order", order.id, "cancelled", {
      locationName: location?.name ?? "Unknown",
    });

    return { success: true as const };
  });

/**
 * Branch employee confirms what actually arrived off the van. This is the
 * ONLY step that touches stock_items.level — it writes a 'delivery' move
 * per item received and bumps the level atomically, all in one transaction
 * alongside the order + item status update.
 *
 * `unloaded` mirrors the branch's off-the-van checklist ticks (see
 * `setItemUnloaded`) and is authoritative here: an item not ticked always
 * receives 0, regardless of whatever quantity happens to be in the payload.
 */
export const confirmReceipt = createServerFn({ method: "POST" })
  .validator(
    z.object({
      orderId: z.string().uuid(),
      items: z
        .array(
          z.object({
            orderItemId: z.string().uuid(),
            unloaded: z.boolean(),
            quantityReceived: z.number().min(0),
          }),
        )
        .min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { db, stockOrders, stockOrderItems, stockItems, stockMoves, locations } =
      await import("@/db");
    const { eq, sql } = await import("drizzle-orm");

    const order = await db.query.stockOrders.findFirst({ where: eq(stockOrders.id, data.orderId) });
    if (!order) throw new Error("Order not found");

    const { requireLocationMember } = await import("@/lib/auth.server");
    const actor = await requireLocationMember(order.locationId);

    if (order.status !== "sent") throw new Error("Order isn't on the van yet");

    const existingItems = await db
      .select({ id: stockOrderItems.id, stockItemId: stockOrderItems.stockItemId })
      .from(stockOrderItems)
      .where(eq(stockOrderItems.orderId, data.orderId));
    const existingById = new Map(existingItems.map((i) => [i.id, i.stockItemId]));
    const invalid = data.items.some((i) => !existingById.has(i.orderItemId));
    if (invalid) throw new Error("Unknown order item");

    let totalReceived = 0;

    await db.transaction(async (tx) => {
      for (const item of data.items) {
        // Not ticked off the van → received 0, regardless of the payload qty.
        const quantityReceived = item.unloaded ? item.quantityReceived : 0;

        await tx
          .update(stockOrderItems)
          .set({ quantityReceived: String(quantityReceived), unloaded: item.unloaded })
          .where(eq(stockOrderItems.id, item.orderItemId));

        if (quantityReceived > 0) {
          const stockItemId = existingById.get(item.orderItemId)!;
          totalReceived += quantityReceived;

          await tx.insert(stockMoves).values({
            stockItemId,
            date: todayDateString(),
            kind: "delivery",
            quantity: String(quantityReceived),
            note: `Order ${data.orderId.slice(0, 8)} delivery`,
            byMemberId: actor.memberId,
          });

          await tx
            .update(stockItems)
            .set({
              level: sql`${stockItems.level} + ${quantityReceived}`,
              updatedAt: new Date(),
            })
            .where(eq(stockItems.id, stockItemId));
        }
      }

      await tx
        .update(stockOrders)
        .set({
          status: "received",
          receivedBy: actor.memberId,
          receivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(stockOrders.id, data.orderId));
    });

    const location = await db.query.locations.findFirst({
      where: eq(locations.id, order.locationId),
    });

    await logActivity("stock_order", order.id, "received", {
      locationName: location?.name ?? "Unknown",
      items: data.items.length,
      totalReceived,
    });

    return { success: true as const };
  });

/**
 * Branch ticks a single item while counting the delivery off the van. Fires
 * on every tap (persisted immediately) so a half-checked delivery survives a
 * refresh; not batched with `confirmReceipt`, which is the actual
 * stock-levels-changing step once every item has been counted.
 */
export const setItemUnloaded = createServerFn({ method: "POST" })
  .validator(z.object({ orderItemId: z.string().uuid(), unloaded: z.boolean() }))
  .handler(async ({ data }) => {
    const { db, stockOrderItems, stockOrders } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const item = await db.query.stockOrderItems.findFirst({
      where: eq(stockOrderItems.id, data.orderItemId),
    });
    if (!item) throw new Error("Order item not found");

    const order = await db.query.stockOrders.findFirst({ where: eq(stockOrders.id, item.orderId) });
    if (!order) throw new Error("Order not found");

    const { requireLocationMember } = await import("@/lib/auth.server");
    await requireLocationMember(order.locationId);

    if (order.status !== "sent") throw new Error("Order isn't on the van yet");
    if (data.unloaded && Number(item.quantitySent ?? 0) <= 0) {
      throw new Error("Nothing was sent for this item");
    }

    await db
      .update(stockOrderItems)
      .set({ unloaded: data.unloaded })
      .where(eq(stockOrderItems.id, data.orderItemId));

    return { success: true as const };
  });

// ── delivery issues: shortfall reason + resolution ──────────────────────

/**
 * Either the branch (whoever spots the shortfall) or the warehouse can log
 * why an order came up short. Non-destructive: logging a new reason just
 * overwrites the open reason text, resolution is a separate step.
 */
export const reportOrderIssue = createServerFn({ method: "POST" })
  .validator(
    z.object({
      orderId: z.string().uuid(),
      reason: z.string().trim().min(1, "Add a reason"),
    }),
  )
  .handler(async ({ data }) => {
    const { db, stockOrders, locations } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const order = await db.query.stockOrders.findFirst({ where: eq(stockOrders.id, data.orderId) });
    if (!order) throw new Error("Order not found");

    await requireOrderIssueActor(order.locationId);

    await db
      .update(stockOrders)
      .set({
        issueReason: data.reason,
        issueResolvedAt: null,
        issueResolvedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(stockOrders.id, data.orderId));

    const location = await db.query.locations.findFirst({
      where: eq(locations.id, order.locationId),
    });

    await logActivity("stock_order", order.id, "issue_reported", {
      locationName: location?.name ?? "Unknown",
      reason: data.reason,
    });

    return { success: true as const };
  });

/** Marks an order's delivery issue settled — with the warehouse, or however it got sorted. */
export const resolveOrderIssue = createServerFn({ method: "POST" })
  .validator(
    z.object({
      orderId: z.string().uuid(),
      note: z.string().trim().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { db, stockOrders, locations } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const order = await db.query.stockOrders.findFirst({ where: eq(stockOrders.id, data.orderId) });
    if (!order) throw new Error("Order not found");

    const actor = await requireOrderIssueActor(order.locationId);

    const note = data.note?.trim();
    const issueReason = note
      ? [order.issueReason, `Resolved: ${note}`].filter(Boolean).join("\n")
      : order.issueReason;

    await db
      .update(stockOrders)
      .set({
        issueReason,
        issueResolvedAt: new Date(),
        issueResolvedBy: actor.memberId,
        updatedAt: new Date(),
      })
      .where(eq(stockOrders.id, data.orderId));

    const location = await db.query.locations.findFirst({
      where: eq(locations.id, order.locationId),
    });

    await logActivity("stock_order", order.id, "issue_resolved", {
      locationName: location?.name ?? "Unknown",
      note: note ?? null,
    });

    return { success: true as const };
  });

// ── warehouse: the dispatch queue ────────────────────────────────────────

/** Every branch's orders, newest first with 'placed' surfaced first. */
export const listWarehouseOrders = createServerFn({ method: "GET" })
  .validator(z.object({ status: orderStatusSchema.optional() }).optional())
  .handler(async ({ data }) => {
    const { requireWarehouse } = await import("@/lib/auth.server");
    await requireWarehouse();

    const { db, stockOrders, stockOrderItems, stockItems, locations, members } =
      await import("@/db");
    const { eq, desc, inArray } = await import("drizzle-orm");

    const orderRows = await db.query.stockOrders.findMany({
      where: data?.status ? eq(stockOrders.status, data.status) : undefined,
      orderBy: [desc(stockOrders.placedAt)],
      limit: 50,
    });

    // 'placed' orders lead the queue (oldest first within that group so the
    // first branch to order is the first one packed); everything else stays
    // newest-first.
    const placed = orderRows
      .filter((o) => o.status === "placed")
      .sort((a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime());
    const rest = orderRows
      .filter((o) => o.status !== "placed")
      .sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());
    const sorted = [...placed, ...rest];

    const orderIds = sorted.map((o) => o.id);
    const orderItemRows = orderIds.length
      ? await db
          .select({
            id: stockOrderItems.id,
            orderId: stockOrderItems.orderId,
            stockItemId: stockOrderItems.stockItemId,
            warehouseProductId: stockOrderItems.warehouseProductId,
            quantityOrdered: stockOrderItems.quantityOrdered,
            quantitySent: stockOrderItems.quantitySent,
            quantityReceived: stockOrderItems.quantityReceived,
            loaded: stockOrderItems.loaded,
            unloaded: stockOrderItems.unloaded,
            itemName: stockItems.name,
            itemUnit: stockItems.unit,
          })
          .from(stockOrderItems)
          .innerJoin(stockItems, eq(stockOrderItems.stockItemId, stockItems.id))
          .where(inArray(stockOrderItems.orderId, orderIds))
      : [];

    const locationIds = Array.from(new Set(sorted.map((o) => o.locationId)));
    const locationRows = locationIds.length
      ? await db.query.locations.findMany({ where: inArray(locations.id, locationIds) })
      : [];
    const locationName = new Map(locationRows.map((l) => [l.id, l.name]));

    const memberIds = Array.from(
      new Set(
        sorted.flatMap((o) =>
          [o.placedBy, o.sentBy, o.receivedBy, o.issueResolvedBy].filter((x): x is string =>
            Boolean(x),
          ),
        ),
      ),
    );
    const memberRows = memberIds.length
      ? await db.query.members.findMany({ where: inArray(members.id, memberIds) })
      : [];
    const memberName = new Map(memberRows.map((m) => [m.id, m.name]));

    return sorted.map((o) => ({
      id: o.id,
      locationId: o.locationId,
      locationName: locationName.get(o.locationId) ?? "Unknown",
      status: o.status as OrderStatus,
      note: o.note,
      sentNote: o.sentNote,
      placedAt: o.placedAt.toISOString(),
      placedByName: memberName.get(o.placedBy) ?? "Unknown",
      sentAt: o.sentAt ? o.sentAt.toISOString() : null,
      sentByName: o.sentBy ? (memberName.get(o.sentBy) ?? "Unknown") : null,
      receivedAt: o.receivedAt ? o.receivedAt.toISOString() : null,
      receivedByName: o.receivedBy ? (memberName.get(o.receivedBy) ?? "Unknown") : null,
      issueReason: o.issueReason,
      issueResolvedAt: o.issueResolvedAt ? o.issueResolvedAt.toISOString() : null,
      issueResolvedByName: o.issueResolvedBy
        ? (memberName.get(o.issueResolvedBy) ?? "Unknown")
        : null,
      items: orderItemRows
        .filter((it) => it.orderId === o.id)
        .map((it) => ({
          orderItemId: it.id,
          stockItemId: it.stockItemId,
          warehouseProductId: it.warehouseProductId,
          name: it.itemName,
          unit: it.itemUnit,
          quantityOrdered: Number(it.quantityOrdered),
          quantitySent: it.quantitySent != null ? Number(it.quantitySent) : null,
          quantityReceived: it.quantityReceived != null ? Number(it.quantityReceived) : null,
          loaded: it.loaded,
          unloaded: it.unloaded,
        })),
    }));
  });

/**
 * Warehouse ticks a single item while physically loading the van. Fires on
 * every tap (persisted immediately) so a half-packed order survives a
 * refresh or a different packer picking up the same order; not batched with
 * `markOrderSent`, which is the actual dispatch step.
 */
export const setItemLoaded = createServerFn({ method: "POST" })
  .validator(z.object({ orderItemId: z.string().uuid(), loaded: z.boolean() }))
  .handler(async ({ data }) => {
    const { requireWarehouse } = await import("@/lib/auth.server");
    await requireWarehouse();

    const { db, stockOrderItems, stockOrders } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const item = await db.query.stockOrderItems.findFirst({
      where: eq(stockOrderItems.id, data.orderItemId),
    });
    if (!item) throw new Error("Order item not found");

    const order = await db.query.stockOrders.findFirst({ where: eq(stockOrders.id, item.orderId) });
    if (!order) throw new Error("Order not found");
    if (order.status !== "placed") throw new Error("Order has already gone out");

    await db
      .update(stockOrderItems)
      .set({ loaded: data.loaded })
      .where(eq(stockOrderItems.id, data.orderItemId));

    return { success: true as const };
  });

/**
 * Warehouse packs the van — adjusting quantities down if they're short — and
 * sends it. `loaded` mirrors the packing checklist ticks (see
 * `setItemLoaded`) and is authoritative here: an item not loaded always
 * dispatches 0, regardless of whatever quantity happens to be in the payload.
 */
export const markOrderSent = createServerFn({ method: "POST" })
  .validator(
    z.object({
      orderId: z.string().uuid(),
      items: z
        .array(
          z.object({
            orderItemId: z.string().uuid(),
            loaded: z.boolean(),
            quantitySent: z.number().min(0),
          }),
        )
        .min(1),
      sentNote: z.string().trim().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { requireWarehouse } = await import("@/lib/auth.server");
    const actor = await requireWarehouse();

    const { db, stockOrders, stockOrderItems, locations } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const order = await db.query.stockOrders.findFirst({ where: eq(stockOrders.id, data.orderId) });
    if (!order) throw new Error("Order not found");
    if (order.status === "cancelled") throw new Error("Order was cancelled");
    if (order.status !== "placed") throw new Error("Already sent");

    const existingItems = await db
      .select({ id: stockOrderItems.id })
      .from(stockOrderItems)
      .where(eq(stockOrderItems.orderId, data.orderId));
    const existingIds = new Set(existingItems.map((i) => i.id));
    const invalid = data.items.some((i) => !existingIds.has(i.orderItemId));
    if (invalid) throw new Error("Unknown order item");

    await db.transaction(async (tx) => {
      for (const item of data.items) {
        // Not loaded → nothing went on the van, regardless of the payload qty.
        const quantitySent = item.loaded ? item.quantitySent : 0;
        await tx
          .update(stockOrderItems)
          .set({ quantitySent: String(quantitySent), loaded: item.loaded })
          .where(eq(stockOrderItems.id, item.orderItemId));
      }

      await tx
        .update(stockOrders)
        .set({
          status: "sent",
          sentBy: actor.memberId,
          sentAt: new Date(),
          sentNote: data.sentNote?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(stockOrders.id, data.orderId));
    });

    const location = await db.query.locations.findFirst({
      where: eq(locations.id, order.locationId),
    });

    await logActivity("stock_order", order.id, "sent", {
      locationName: location?.name ?? "Unknown",
    });

    return { success: true as const };
  });
