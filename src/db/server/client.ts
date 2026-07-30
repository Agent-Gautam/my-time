// Drizzle client. Server-only — importing this from the UI is an ESLint error by
// design (D33, D42). Only `sync/` and route handlers may reach it.
//
// **Connected lazily, on first query, not at import.** The eager version threw from
// module scope when DATABASE_URL was unset, and Next.js's build collects page data by
// importing every route — so a missing credential failed the *build*, reported as the
// fairly misleading "Failed to collect page data for /api/cron/remind". Building is a
// compile step and must not require production secrets; a missing DATABASE_URL is a
// runtime problem and belongs on the request that actually needs the database.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let instance: Db | null = null;

function connect(): Db {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — see .env.example.");
  }

  // Supabase's transaction-mode pooler (:6543) is the serverless-safe endpoint, and it
  // cannot hold prepared statements, so `prepare: false` is required rather than a
  // tuning choice. One connection per function instance (Architecture.md §10).
  const client = postgres(connectionString, { prepare: false, max: 1 });
  return drizzle(client, { schema });
}

/**
 * A proxy, so call sites keep reading `db.select(...)` unchanged while the connection
 * opens only when a property is actually touched. Memoised per function instance, so
 * this is still one connection — just deferred past build time.
 */
export const db = new Proxy({} as Db, {
  get(_target, property, receiver) {
    instance ??= connect();
    return Reflect.get(instance, property, receiver);
  },
});
