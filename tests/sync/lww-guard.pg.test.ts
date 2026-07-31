// The LWW guard, against a real Postgres.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS, AND WHY IT NEEDS A DATABASE
// ---------------------------------------------------------------------------
// Every other test in `tests/sync/**` runs against a scripted transport, which is the
// right shape for the merge rules — they are pure, and a Postgres would only slow them
// down. But it left one class of defect completely invisible, and that class shipped:
//
//   `newerThanStored` built the `ON CONFLICT ... WHERE` guard as sql`${col} < ${date}`.
//   A raw `sql` template binds its value with no knowledge of the column, so a JS `Date`
//   never reached the timestamptz encoder and postgres.js refused the whole statement.
//   Every `users` / `dayparts` / `goals` / `stages` / `pushSubscriptions` push was
//   rejected, on every device, from the very first sync — while the plan and the
//   append-only tables, which do not use this guard, synced perfectly.
//
// Nothing short of a real driver can catch that. The SQL string is correct; rendering it
// through `drizzle.mock` and reading it (which a previous session did) shows nothing
// wrong. The failure is in **encoding a parameter**, which only happens when a real
// connection serializes the message.
//
// ---------------------------------------------------------------------------
// SAFETY AND SKIPPING
// ---------------------------------------------------------------------------
// Every case runs inside a transaction that is **always rolled back**, so this writes
// nothing durable even against the production database.
//
// It is skipped when `DATABASE_URL` is absent, which is the case in CI. That is a real
// limitation and worth stating plainly: this suite protects the developer who runs
// `npm run test` locally with `.env.local` present, and it does not protect `main`. The
// alternative — a throwaway Postgres in CI — is a dependency and an infrastructure
// decision (D50), not this fix's to make.

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, lt, type AnyColumn } from "drizzle-orm";
import postgres from "postgres";

import { dayparts, goals, users } from "@/db/server/schema";
import { LOCAL_USER_ID } from "@/db/ids";

// Vitest is not Next.js and does not read `.env.local` on its own — the same reason
// `drizzle.config.ts` calls this. Node 22 built-in, no dependency added.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No local env file; the guard below handles it.
}

const DATABASE_URL = process.env.DATABASE_URL;

/** A rollback marker, so a clean run and a real failure are distinguishable. */
const ROLLBACK = "__rollback__";

const toDb = (iso: string): Date => new Date(`${iso}Z`);

/** The production helper, reproduced exactly — `route.ts` cannot be imported here
 *  (it pulls in `next/server` and the whole route module). If that helper changes,
 *  this must change with it. */
const newerThanStored = (column: AnyColumn, updatedAt: string) =>
  lt(column, toDb(updatedAt));

describe.skipIf(!DATABASE_URL)("LWW guard renders SQL Postgres accepts", () => {
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    client = postgres(DATABASE_URL!, { prepare: false });
    db = drizzle(client);
  });

  afterAll(async () => {
    await client?.end();
  });

  /** Run `fn` against the real database and undo it, whatever happened. */
  async function rolledBack(fn: (tx: never) => Promise<void>): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        await fn(tx as never);
        throw new Error(ROLLBACK);
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
    }
  }

  const UPDATED_AT = "2026-07-31T10:42:39";

  it("accepts a conditional upsert on `users`", async () => {
    await rolledBack(async (tx) => {
      const set = {
        email: null,
        updatedAt: toDb(UPDATED_AT),
        serverUpdatedAt: new Date(),
      };
      await (tx as unknown as typeof db)
        .insert(users)
        .values({ id: LOCAL_USER_ID, ...set })
        .onConflictDoUpdate({
          target: users.id,
          set,
          setWhere: newerThanStored(users.updatedAt, UPDATED_AT),
        });
    });
  });

  it("accepts a conditional upsert on `dayparts`", async () => {
    await rolledBack(async (tx) => {
      const set = {
        name: "Morning",
        startTime: "05:00",
        endTime: "12:00",
        activeCap: 2,
        sortOrder: 0,
        updatedAt: toDb(UPDATED_AT),
        deletedAt: null,
        serverUpdatedAt: new Date(),
      };
      await (tx as unknown as typeof db)
        .insert(dayparts)
        .values({ id: "daypart-morning", userId: LOCAL_USER_ID, ...set })
        .onConflictDoUpdate({
          target: dayparts.id,
          set,
          setWhere: newerThanStored(dayparts.updatedAt, UPDATED_AT),
        });
    });
  });

  it("accepts a conditional upsert on `goals`", async () => {
    await rolledBack(async (tx) => {
      const set = {
        name: "Test goal",
        purpose: "regression",
        tier: 1,
        state: "active" as const,
        updatedAt: toDb(UPDATED_AT),
        deletedAt: null,
        serverUpdatedAt: new Date(),
      };
      await (tx as unknown as typeof db)
        .insert(goals)
        .values({
          id: "00000000-0000-4000-8000-0000000000ff",
          userId: LOCAL_USER_ID,
          ...set,
        })
        .onConflictDoUpdate({
          target: goals.id,
          set,
          setWhere: newerThanStored(goals.updatedAt, UPDATED_AT),
        });
    });
  });

  // The guard has to still *work*, not merely parse: a stale write must not overwrite.
  it("suppresses an update whose `updatedAt` is older than stored", async () => {
    await rolledBack(async (tx) => {
      const database = tx as unknown as typeof db;
      const insert = async (name: string, updatedAt: string) => {
        const set = {
          name,
          purpose: "regression",
          tier: 1,
          state: "active" as const,
          updatedAt: toDb(updatedAt),
          deletedAt: null,
          serverUpdatedAt: new Date(),
        };
        await database
          .insert(goals)
          .values({
            id: "00000000-0000-4000-8000-0000000000fe",
            userId: LOCAL_USER_ID,
            ...set,
          })
          .onConflictDoUpdate({
            target: goals.id,
            set,
            setWhere: newerThanStored(goals.updatedAt, updatedAt),
          });
      };

      await insert("newer", "2026-07-31T12:00:00");
      await insert("stale", "2026-07-31T09:00:00");

      const [stored] = await database
        .select({ name: goals.name })
        .from(goals)
        .where(eq(goals.id, "00000000-0000-4000-8000-0000000000fe"));

      expect(stored?.name).toBe("newer");
    });
  });
});
