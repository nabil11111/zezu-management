import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { logActivity } from "@/server/activity";
import { SETTING_KEYS, asSettingBool, asSettingStr } from "@/server/settings-flags";

/**
 * The CEO-facing settings server fns. The plain `getVisibilityFlags` helper
 * and the key constants live in `settings-flags.ts` (server-only, no server
 * fns) so importing THIS file from the settings route never drags `postgres`
 * into the browser bundle.
 *
 * Keys (settings table, key → jsonb value):
 *   sales_visible     — CEO can see sales figures (hidden from everyone else)
 *   salary_visible    — same, for pay / payroll figures
 *   welcome_video_url — the first-login intro video every new hire must watch
 */

/** CEO: read the current settings for the settings screen. */
export const getAppSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { requireCeo } = await import("@/lib/auth.server");
  await requireCeo();

  const { db, settings } = await import("@/db");
  const rows = await db.select({ key: settings.key, value: settings.value }).from(settings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    salesVisible: asSettingBool(map.get(SETTING_KEYS.salesVisible)),
    salaryVisible: asSettingBool(map.get(SETTING_KEYS.salaryVisible)),
    welcomeVideoUrl: asSettingStr(map.get(SETTING_KEYS.welcomeVideoUrl)),
  };
});

/** CEO: patch any of the three settings (only sent keys are written). */
export const updateAppSettings = createServerFn({ method: "POST" })
  .validator(
    z.object({
      salesVisible: z.boolean().optional(),
      salaryVisible: z.boolean().optional(),
      welcomeVideoUrl: z.string().trim().max(2000).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { requireCeo } = await import("@/lib/auth.server");
    await requireCeo();

    const { db, settings } = await import("@/db");
    const { sql } = await import("drizzle-orm");

    async function put(key: string, value: unknown) {
      await db
        .insert(settings)
        .values({ key, value: value as object })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: value as object, updatedAt: sql`now()` },
        });
    }

    if (data.salesVisible !== undefined) await put(SETTING_KEYS.salesVisible, data.salesVisible);
    if (data.salaryVisible !== undefined) await put(SETTING_KEYS.salaryVisible, data.salaryVisible);
    if (data.welcomeVideoUrl !== undefined) {
      await put(SETTING_KEYS.welcomeVideoUrl, data.welcomeVideoUrl || null);
    }

    await logActivity("settings", "app", "updated", { changed: Object.keys(data) });
    return { success: true as const };
  });
