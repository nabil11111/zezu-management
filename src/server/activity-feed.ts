import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { JsonValue } from "@/server/types";

/**
 * The read side of the activity log, split from `activity.ts` on purpose:
 * routes import `listActivity` from here, while `logActivity` (a plain
 * function whose body survives in client bundles) lives alone in
 * `activity.ts` where only stripped server-fn handlers reference it. Merging
 * the two pulls `@/db`'s dynamic import into the client graph and the
 * browser build fails on `postgres`.
 */

/** Auth-gated: most recent activity-log rows, newest first. */
export const listActivity = createServerFn({ method: "GET" })
  .validator(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
  .handler(async ({ data }) => {
    const { requireAuth } = await import("@/lib/auth.server");
    await requireAuth();

    const { db, activityLog } = await import("@/db");
    const { desc } = await import("drizzle-orm");

    const rows = await db
      .select()
      .from(activityLog)
      .orderBy(desc(activityLog.createdAt))
      .limit(data?.limit ?? 50);

    return rows.map((r) => ({ ...r, detail: r.detail as JsonValue | null }));
  });
