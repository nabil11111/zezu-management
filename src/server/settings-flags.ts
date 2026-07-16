/**
 * Plain, server-only settings helpers — deliberately in their own file with
 * NO `createServerFn`. A module that mixes a plain db-touching helper with
 * server fns AND is imported by a client route drags `postgres` into the
 * browser bundle (the server-fn stripping can't tree-shake the plain
 * function's dynamic `@/db` import). Keeping this leaf plain-only makes it
 * safe to reach from anywhere. The server FNS live in `app-settings.ts`.
 */

export const SETTING_KEYS = {
  salesVisible: "sales_visible",
  salaryVisible: "salary_visible",
  welcomeVideoUrl: "welcome_video_url",
} as const;

export const asSettingBool = (v: unknown) => v === true || v === "true";
export const asSettingStr = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

/** Server-side flag check for gating sensitive data. Both default to false. */
export async function getVisibilityFlags(): Promise<{
  salesVisible: boolean;
  salaryVisible: boolean;
}> {
  const { db, settings } = await import("@/db");
  const { inArray } = await import("drizzle-orm");
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [SETTING_KEYS.salesVisible, SETTING_KEYS.salaryVisible]));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    salesVisible: asSettingBool(map.get(SETTING_KEYS.salesVisible)),
    salaryVisible: asSettingBool(map.get(SETTING_KEYS.salaryVisible)),
  };
}
