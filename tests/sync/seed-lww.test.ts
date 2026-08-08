// D72 — a reseed must never overwrite settings that already exist on the server.
//
// This is the regression test for a shipped data-loss bug: `seedIfEmpty` enqueues, seed
// ids are deterministic (D58) so a seed row is an *update* of the user's own row, and
// the LWW guard on both sides is a plain `>` on `updatedAt`. Stamped with the clock,
// today's defaults beat last week's real settings and the app silently resets itself.
//
// The assertions are deliberately on `shouldApplyMutable` — the function `sync/pull.ts`
// and `app/api/sync/route.ts` both decide with (`sync/merge.ts`'s whole reason to
// exist). Testing the seed's stamp against the same predicate the server uses is what
// makes this cover the *server* overwrite, which no client-side assertion could reach.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { localDb } from "@/db/local/schema";
import { DEFAULT_DAYPARTS, seedIfEmpty } from "@/db/local/seed";
import { getOutboxDepth } from "@/db/local/queries";
import { shouldApplyMutable } from "@/sync/merge";

// Local wall-clock, no Z — D53.
const EDITED_AT = "2026-07-20T08:30:00";
const RESEEDED_AT = "2026-08-04T09:00:00";

beforeEach(async () => {
  await Promise.all(localDb.tables.map((table) => table.clear()));
});

describe("seedIfEmpty stamping (D72)", () => {
  it("seeds rows that lose LWW against a real edit, however much later the seed runs", async () => {
    await seedIfEmpty(RESEEDED_AT);

    // What the server holds: the same row, edited by the user two weeks earlier.
    const stored = { updatedAt: EDITED_AT };

    for (const seeded of await localDb.dayparts.toArray()) {
      expect(shouldApplyMutable(stored, seeded)).toBe(false);
    }

    const seededUser = await localDb.users.toArray();
    expect(seededUser).toHaveLength(1);
    expect(shouldApplyMutable(stored, seededUser[0])).toBe(false);
  });

  it("still enqueues, so a genuinely first device populates an empty server", async () => {
    await seedIfEmpty(RESEEDED_AT);

    // One user + four dayparts. The rows are ancient, but they are queued now.
    expect(await getOutboxDepth()).toBe(DEFAULT_DAYPARTS.length + 1);

    const queued = await localDb.outbox.toArray();
    for (const row of queued) expect(row.queuedAt).toBe(RESEEDED_AT);
  });

  it("is still a no-op on a device that already has dayparts", async () => {
    await seedIfEmpty(RESEEDED_AT);
    await localDb.outbox.clear();

    expect(await seedIfEmpty(RESEEDED_AT)).toBe(false);
    expect(await getOutboxDepth()).toBe(0);
  });

  it("does not stop a later real edit from winning", async () => {
    await seedIfEmpty(RESEEDED_AT);
    const seeded = (await localDb.dayparts.toArray())[0];

    // The user edits it after the seed. That must beat the seed, or a fresh device
    // could never change its own boundaries.
    expect(shouldApplyMutable(seeded, { updatedAt: RESEEDED_AT })).toBe(true);
  });
});
