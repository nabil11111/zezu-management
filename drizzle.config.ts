import { defineConfig } from "drizzle-kit";

// Note: drizzle-kit reads DATABASE_URL directly from process.env (not via
// src/lib/env.ts) so `drizzle-kit generate` can run without the full env
// schema (e.g. S3 vars) being present — it only needs a Postgres URL to
// generate/run migrations.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/placeholder",
  },
});
