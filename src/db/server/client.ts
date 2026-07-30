// Drizzle client. Server-only — importing this from the UI is an ESLint error by
// design (D33, D42). Only `sync/` and route handlers may reach it.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set — see .env.example.");
}

// Supabase's transaction-mode pooler (:6543) is the serverless-safe endpoint, and it
// cannot hold prepared statements, so `prepare: false` is required rather than a
// tuning choice. One connection per function instance (Architecture.md §10).
const client = postgres(connectionString, { prepare: false, max: 1 });

export const db = drizzle(client, { schema });
