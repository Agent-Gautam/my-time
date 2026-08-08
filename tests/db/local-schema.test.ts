// Dexie parses `version(1).stores({...})` from strings, so a typo in an index spec
// is invisible to `tsc` and to ESLint and only fails at `open()` — on a real device,
// in a later wave. This asserts that every index `queries.ts` reaches for actually
// exists, which needs no IndexedDB: Dexie builds its schema at construction time.

import { describe, expect, it } from "vitest";

import { localDb, SYNCED_TABLES } from "@/db/local/schema";

const indexNames = (table: string) =>
  localDb.table(table).schema.indexes.map((index) => index.name);

describe("Dexie local schema", () => {
  it("declares every synced table plus the local-only outbox and settings", () => {
    const declared = localDb.tables.map((table) => table.name).sort();
    expect(declared).toEqual([...SYNCED_TABLES, "outbox", "settings"].sort());
  });

  it("indexes session_logs for date ranges and keyset pagination (D47)", () => {
    expect(indexNames("sessionLogs")).toEqual(
      expect.arrayContaining(["[stageId+date]", "[date+daypartId]", "[date+id]", "date"]),
    );
  });

  it("indexes checkpoints and check_ins for their bounded queries (D47)", () => {
    expect(indexNames("checkpoints")).toContain("[stageId+loggedAt]");
    expect(indexNames("checkIns")).toEqual(
      expect.arrayContaining(["[date+daypartId]", "date", "checkedInAt"]),
    );
  });

  it("indexes tasks for the occurrence read, the week scan, and the per-stage history (D68, D70)", () => {
    expect(indexNames("tasks")).toEqual(
      expect.arrayContaining(["[date+daypartId]", "date", "[stageId+date]", "stageId"]),
    );
  });

  it("indexes plan_slots by week and by daypart (D45)", () => {
    expect(indexNames("planSlots")).toEqual(
      expect.arrayContaining(["[weekStart+date]", "[date+daypartId]", "planWeekId"]),
    );
  });

  it("indexes stages.eligibleDayparts as multiEntry (D9)", () => {
    const index = localDb
      .table("stages")
      .schema.indexes.find((candidate) => candidate.keyPath === "eligibleDayparts");
    expect(index?.multi).toBe(true);
  });

  it("keys the outbox on an auto-incrementing seq, so peek is FIFO", () => {
    const primKey = localDb.table("outbox").schema.primKey;
    expect(primKey.keyPath).toBe("seq");
    expect(primKey.auto).toBe(true);
  });

  it("does not index deletedAt — IndexedDB cannot index null", () => {
    for (const table of ["dayparts", "goals", "stages"]) {
      expect(indexNames(table)).not.toContain("deletedAt");
    }
  });
});
