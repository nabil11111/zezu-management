import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { logActivity } from "@/server/activity";

/**
 * Location (shop) server functions. "A new location is a switch-on, not a
 * project" — creating one just needs a name; the slug and QR token are
 * minted automatically and every other module (sales, stock, shifts, crew)
 * hangs off the location id from that point on.
 *
 * `listLocations` is the shared contract other modules import: no args,
 * scoped to the actor's assigned locations (CEO sees everything).
 */

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const createLocationSchema = z.object({
  name: z.string().min(1),
  address: z.string().trim().min(1).optional(),
  sortOrder: z.number().int().optional(),
});

const updateLocationSchema = z.object({
  id: z.string().uuid(),
  patch: z.object({
    name: z.string().min(1).optional(),
    address: z.string().optional().nullable(),
    sortOrder: z.number().int().optional(),
  }),
});

/**
 * Shared contract: every signed-in actor, scoped to what they may operate
 * on. CEO → every location (active and inactive — callers filter). Manager
 * / staff → only their `member_locations` assignments. Sorted by
 * `sortOrder` then `name`.
 */
export const listLocations = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAuth, getActorLocationIds } = await import("@/lib/auth.server");
  const actor = await requireAuth();
  const locationIds = await getActorLocationIds(actor);

  const { db, locations } = await import("@/db");
  const { asc, inArray } = await import("drizzle-orm");

  if (locationIds !== "all" && locationIds.length === 0) return [];

  const rows = await db
    .select({
      id: locations.id,
      name: locations.name,
      slug: locations.slug,
      address: locations.address,
      active: locations.active,
      sortOrder: locations.sortOrder,
    })
    .from(locations)
    .where(locationIds === "all" ? undefined : inArray(locations.id, locationIds))
    .orderBy(asc(locations.sortOrder), asc(locations.name));

  return rows;
});

/** CEO only: every location with its QR token, timestamps, and crew count. */
export const listLocationsAdmin = createServerFn({ method: "GET" }).handler(async () => {
  const { requireCeo } = await import("@/lib/auth.server");
  await requireCeo();

  const { db, locations, memberLocations } = await import("@/db");
  const { asc, eq, sql } = await import("drizzle-orm");

  const rows = await db
    .select({
      id: locations.id,
      name: locations.name,
      slug: locations.slug,
      address: locations.address,
      qrToken: locations.qrToken,
      active: locations.active,
      sortOrder: locations.sortOrder,
      createdAt: locations.createdAt,
      memberCount: sql<number>`cast(count(distinct ${memberLocations.memberId}) as int)`,
    })
    .from(locations)
    .leftJoin(memberLocations, eq(memberLocations.locationId, locations.id))
    .groupBy(locations.id)
    .orderBy(asc(locations.sortOrder), asc(locations.name));

  return rows;
});

/** CEO only: switch on a new location — a fresh slug, a fresh QR token. */
export const createLocation = createServerFn({ method: "POST" })
  .validator(createLocationSchema)
  .handler(async ({ data }) => {
    const { requireCeo, generateToken } = await import("@/lib/auth.server");
    await requireCeo();

    const { db, locations } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const base = slugify(data.name) || "location";
    let slug = base;
    let suffix = 2;
    while (await db.query.locations.findFirst({ where: eq(locations.slug, slug) })) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }

    const [row] = await db
      .insert(locations)
      .values({
        name: data.name,
        slug,
        address: data.address ?? null,
        qrToken: generateToken(),
        sortOrder: data.sortOrder ?? 0,
      })
      .returning();

    await logActivity("location", row.id, "created", { name: row.name });
    return row;
  });

/** CEO only: name, address, sortOrder — the slug stays put once minted. */
export const updateLocation = createServerFn({ method: "POST" })
  .validator(updateLocationSchema)
  .handler(async ({ data }) => {
    const { requireCeo } = await import("@/lib/auth.server");
    await requireCeo();

    const { db, locations } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const [row] = await db
      .update(locations)
      .set({ ...data.patch, updatedAt: new Date() })
      .where(eq(locations.id, data.id))
      .returning();

    await logActivity("location", data.id, "updated", { ...data.patch, name: row.name });
    return row;
  });

/** CEO only: switch a location on/off. */
export const setLocationActive = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), active: z.boolean() }))
  .handler(async ({ data }) => {
    const { requireCeo } = await import("@/lib/auth.server");
    await requireCeo();

    const { db, locations } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const [row] = await db
      .update(locations)
      .set({ active: data.active, updatedAt: new Date() })
      .where(eq(locations.id, data.id))
      .returning();

    await logActivity("location", data.id, data.active ? "activated" : "deactivated", {
      name: row.name,
    });
    return row;
  });

/**
 * CEO only: mint a fresh QR token — the old printed poster stops working
 * the instant this runs. That's the point: a lost or leaked poster is dead
 * on arrival, no separate "disable" step needed.
 */
export const regenerateQrToken = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { requireCeo, generateToken } = await import("@/lib/auth.server");
    await requireCeo();

    const { db, locations } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    const qrToken = generateToken();
    const [row] = await db
      .update(locations)
      .set({ qrToken, updatedAt: new Date() })
      .where(eq(locations.id, data.id))
      .returning();

    await logActivity("location", data.id, "qr_regenerated", { name: row.name });
    return { id: row.id, qrToken: row.qrToken };
  });
