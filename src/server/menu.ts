import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { logActivity } from "@/server/activity";

/**
 * Menu: the brand-level dish library every location inherits (menu_items has
 * no locationId — one menu, three shops). Each dish carries a short training
 * video next to its recipe notes so every site plates it the same way.
 *
 * Visibility: staff (the crew training from this page) only ever see
 * published dishes. CEO/manager see everything, including drafts. Only the
 * CEO can create, edit, delete or reorder — this is the brand's single
 * source of truth for the menu.
 */

const createInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  category: z.string().trim().min(1).optional().nullable(),
  price: z.number().nonnegative().optional().nullable(),
  description: z.string().trim().min(1).optional().nullable(),
  videoUrl: z.string().trim().min(1).optional().nullable(),
  coverUrl: z.string().trim().min(1).optional().nullable(),
  isBestseller: z.boolean().optional(),
  published: z.boolean().optional(),
});

const patchInput = z.object({
  name: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional().nullable(),
  price: z.number().nonnegative().optional().nullable(),
  description: z.string().trim().min(1).optional().nullable(),
  videoUrl: z.string().trim().min(1).optional().nullable(),
  coverUrl: z.string().trim().min(1).optional().nullable(),
  isBestseller: z.boolean().optional(),
  published: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Auth-gated: the dish library. Staff see published dishes only. */
export const listMenu = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAuth } = await import("@/lib/auth.server");
  const actor = await requireAuth();

  const { db, menuItems } = await import("@/db");
  const { asc, eq } = await import("drizzle-orm");

  const rows = await db.query.menuItems.findMany({
    where: actor.role === "staff" ? eq(menuItems.published, true) : undefined,
    orderBy: [asc(menuItems.category), asc(menuItems.sortOrder), asc(menuItems.name)],
  });

  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    price: r.price,
    description: r.description,
    videoUrl: r.videoUrl,
    coverUrl: r.coverUrl,
    isBestseller: r.isBestseller,
    published: r.published,
    sortOrder: r.sortOrder,
  }));

  const categories = Array.from(
    new Set(items.map((i) => i.category).filter((c): c is string => Boolean(c))),
  ).sort((a, b) => a.localeCompare(b));

  return { items, categories };
});

/** CEO only: add a dish to the brand library. */
export const createMenuItem = createServerFn({ method: "POST" })
  .validator(createInput)
  .handler(async ({ data }) => {
    const { requireCeo } = await import("@/lib/auth.server");
    await requireCeo();

    const { db, menuItems } = await import("@/db");
    const { sql } = await import("drizzle-orm");

    const [maxRow] = await db
      .select({ max: sql<number>`coalesce(max(${menuItems.sortOrder}), -1)` })
      .from(menuItems);
    const sortOrder = (maxRow?.max ?? -1) + 1;

    const [item] = await db
      .insert(menuItems)
      .values({
        name: data.name,
        category: data.category ?? null,
        price: data.price != null ? String(data.price) : null,
        description: data.description ?? null,
        videoUrl: data.videoUrl ?? null,
        coverUrl: data.coverUrl ?? null,
        isBestseller: data.isBestseller ?? false,
        published: data.published ?? true,
        sortOrder,
      })
      .returning();

    await logActivity("menu_item", item.id, "created", { name: item.name });
    return item;
  });

/** CEO only: edit any field on a dish. */
export const updateMenuItem = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), patch: patchInput }))
  .handler(async ({ data }) => {
    const { requireCeo } = await import("@/lib/auth.server");
    await requireCeo();

    const { db, menuItems } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const { price, ...rest } = data.patch;

    const [item] = await db
      .update(menuItems)
      .set({
        ...rest,
        ...(price !== undefined ? { price: price != null ? String(price) : null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(menuItems.id, data.id))
      .returning();

    await logActivity("menu_item", data.id, "updated", { name: item?.name });
    return item;
  });

/** CEO only: remove a dish from the brand library. */
export const deleteMenuItem = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { requireCeo } = await import("@/lib/auth.server");
    await requireCeo();

    const { db, menuItems } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const [existing] = await db
      .select({ name: menuItems.name })
      .from(menuItems)
      .where(eq(menuItems.id, data.id));

    await db.delete(menuItems).where(eq(menuItems.id, data.id));

    await logActivity(
      "menu_item",
      data.id,
      "deleted",
      existing ? { name: existing.name } : undefined,
    );
    return { success: true as const };
  });

/** CEO only: set a dish's sort position within the library. */
export const reorderMenuItem = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), sortOrder: z.number().int().min(0) }))
  .handler(async ({ data }) => {
    const { requireCeo } = await import("@/lib/auth.server");
    await requireCeo();

    const { db, menuItems } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const [item] = await db
      .update(menuItems)
      .set({ sortOrder: data.sortOrder, updatedAt: new Date() })
      .where(eq(menuItems.id, data.id))
      .returning();

    await logActivity("menu_item", data.id, "reordered", { sortOrder: data.sortOrder });
    return item;
  });
