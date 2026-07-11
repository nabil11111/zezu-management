import "dotenv/config";
import { z } from "zod";

/**
 * Server-only environment schema.
 *
 * IMPORTANT: This module must never be imported from client-side code —
 * only from server functions, `*.server.ts` files, or the DB client. It's
 * validated lazily (on first `getEnv()` call), NOT at module import time,
 * so the client build never needs real env values to succeed.
 *
 * No S3 vars yet: v1 has no file uploads (menu videos are pasted URLs).
 * When storage lands, add the S3_* block back from polarity-management.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z.string().min(1, "SESSION_SECRET is required"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Lazily validates and returns the process environment. Throws a readable
 * error the first time it's called if required vars are missing — this is
 * intentionally NOT called at module import time so `npm run build` (which
 * imports server modules to bundle them) succeeds without real secrets.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid or missing environment variables:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}
