import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { logActivity } from "@/server/activity";

/**
 * Warehouse catalog: the products the central warehouse actually carries.
 * Branches can only order what's listed here AND currently marked
 * available — the warehouse builds and maintains this list itself (the DB
 * starts with it empty; there's no seeding step).
 *
 * Only createServerFn + zod are statically imported here — db and
 * auth.server are reached via dynamic `import()` inside each handler so
 * this file stays safe to import from client-rendered routes.
 */

export const listWarehouseCatalog = createServerFn({ method: "GET" }).handler(async () => {
  const { requireWarehouse } = await import("@/lib/auth.server");
  await requireWarehouse();

  const { db, warehouseProducts } = await import("@/db");
  const { asc } = await import("drizzle-orm");

  const rows = await db
    .select()
    .from(warehouseProducts)
    .orderBy(asc(warehouseProducts.sortOrder), asc(warehouseProducts.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    quantity: r.quantity != null ? Number(r.quantity) : null,
    supplier: r.supplier,
    available: r.available,
    active: r.active,
    sortOrder: r.sortOrder,
  }));
});

export const createWarehouseProduct = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().trim().min(1),
      unit: z.string().trim().min(1),
      quantity: z.number().nonnegative().optional().nullable(),
      supplier: z.string().trim().optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const { requireWarehouse } = await import("@/lib/auth.server");
    await requireWarehouse();

    const { db, warehouseProducts } = await import("@/db");
    const { sql } = await import("drizzle-orm");

    const [row] = await db
      .insert(warehouseProducts)
      .values({
        name: data.name,
        unit: data.unit,
        quantity: data.quantity != null ? String(data.quantity) : null,
        supplier: data.supplier || null,
        available: true,
        active: true,
        sortOrder: sql`(select coalesce(max(sort_order), -1) + 1 from warehouse_products)`,
      })
      .returning();

    await logActivity("warehouse_product", row.id, "created", { name: row.name });

    return {
      ...row,
      quantity: row.quantity != null ? Number(row.quantity) : null,
    };
  });

export const updateWarehouseProduct = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().uuid(),
      patch: z.object({
        name: z.string().trim().min(1).optional(),
        unit: z.string().trim().min(1).optional(),
        quantity: z.number().nonnegative().nullable().optional(),
        supplier: z.string().trim().nullable().optional(),
        sortOrder: z.number().int().optional(),
      }),
    }),
  )
  .handler(async ({ data }) => {
    const { requireWarehouse } = await import("@/lib/auth.server");
    await requireWarehouse();

    const { db, warehouseProducts } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const { quantity, supplier, ...rest } = data.patch;
    const [row] = await db
      .update(warehouseProducts)
      .set({
        ...rest,
        ...(quantity !== undefined ? { quantity: quantity != null ? String(quantity) : null } : {}),
        ...(supplier !== undefined ? { supplier: supplier || null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(warehouseProducts.id, data.id))
      .returning();
    if (!row) throw new Error("Product not found");

    await logActivity("warehouse_product", data.id, "updated", data.patch);

    return { ...row, quantity: row.quantity != null ? Number(row.quantity) : null };
  });

/** Off = out of stock: branches can't order it until it's back on. */
export const setWarehouseProductAvailable = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), available: z.boolean() }))
  .handler(async ({ data }) => {
    const { requireWarehouse } = await import("@/lib/auth.server");
    await requireWarehouse();

    const { db, warehouseProducts } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const [row] = await db
      .update(warehouseProducts)
      .set({ available: data.available, updatedAt: new Date() })
      .where(eq(warehouseProducts.id, data.id))
      .returning();
    if (!row) throw new Error("Product not found");

    await logActivity(
      "warehouse_product",
      data.id,
      data.available ? "made_available" : "made_unavailable",
      { name: row.name },
    );

    return { ...row, quantity: row.quantity != null ? Number(row.quantity) : null };
  });

/** Retire a product entirely — it drops off the catalog, not just "out of stock". */
export const setWarehouseProductActive = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), active: z.boolean() }))
  .handler(async ({ data }) => {
    const { requireWarehouse } = await import("@/lib/auth.server");
    await requireWarehouse();

    const { db, warehouseProducts } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const [row] = await db
      .update(warehouseProducts)
      .set({ active: data.active, updatedAt: new Date() })
      .where(eq(warehouseProducts.id, data.id))
      .returning();
    if (!row) throw new Error("Product not found");

    await logActivity("warehouse_product", data.id, data.active ? "activated" : "retired", {
      name: row.name,
    });

    return { ...row, quantity: row.quantity != null ? Number(row.quantity) : null };
  });
