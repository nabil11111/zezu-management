import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

let client: postgres.Sql | null = null;
let instance: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Lazily creates (and memoizes) the postgres client + drizzle instance.
 * Reads env lazily via getEnv() so importing this module never fails at
 * build time — only the first query at runtime requires DATABASE_URL.
 */
function getDb() {
  if (!instance) {
    const env = getEnv();
    client = postgres(env.DATABASE_URL, { prepare: false });
    instance = drizzle(client, { schema });
  }
  return instance;
}

/**
 * Proxy so consumers can `import { db } from "@/db"` and use it like a
 * normal drizzle instance, while the underlying client is only created
 * on first actual use (query, transaction, etc.).
 */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
});

export * from "./schema";
