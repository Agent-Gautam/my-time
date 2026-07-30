// The merge rules on their own — no database, no transport.
//
// These are the rules the client's pull and the server's route handler *both* import,
// so this file is the closest thing there is to a test of the server half: if the two
// sides ever answer "does the incoming row win?" differently, it is because one of them
// stopped calling these functions, not because they drifted.

import { describe, expect, it } from "vitest";

import {
  comparePlanWeek,
  isAppendOnly,
  planWeekLineage,
  shouldApplyMutable,
  shouldApplyWeek,
  type PlanWeekRank,
} from "@/sync/merge";

describe("isAppendOnly", () => {
  it("covers exactly the three fact tables (D32)", () => {
    expect(isAppendOnly("sessionLogs")).toBe(true);
    expect(isAppendOnly("checkpoints")).toBe(true);
    expect(isAppendOnly("checkIns")).toBe(true);

    expect(isAppendOnly("goals")).toBe(false);
    expect(isAppendOnly("stages")).toBe(false);
    expect(isAppendOnly("dayparts")).toBe(false);
    expect(isAppendOnly("users")).toBe(false);
    expect(isAppendOnly("pushSubscriptions")).toBe(false);
    expect(isAppendOnly("planWeeks")).toBe(false);
    expect(isAppendOnly("planSlots")).toBe(false);
  });
});

describe("shouldApplyMutable", () => {
  const at = (updatedAt: string) => ({ updatedAt });

  it("takes the later write", () => {
    expect(shouldApplyMutable(at("2026-07-30T09:00:00"), at("2026-07-30T10:00:00"))).toBe(
      true,
    );
  });

  it("rejects an older write", () => {
    expect(shouldApplyMutable(at("2026-07-30T10:00:00"), at("2026-07-30T09:00:00"))).toBe(
      false,
    );
  });

  it("keeps what it already has on a tie", () => {
    expect(shouldApplyMutable(at("2026-07-30T10:00:00"), at("2026-07-30T10:00:00"))).toBe(
      false,
    );
  });

  it("applies anything when it holds nothing", () => {
    expect(shouldApplyMutable(null, at("2020-01-01T00:00:00"))).toBe(true);
    expect(shouldApplyMutable(undefined, at("2020-01-01T00:00:00"))).toBe(true);
  });

  it("orders naive local wall-clock strings chronologically (D53)", () => {
    // The reason string comparison is legitimate here: no Z, no offset, fixed width.
    expect(shouldApplyMutable(at("2026-01-09T23:59:59"), at("2026-01-10T00:00:00"))).toBe(
      true,
    );
  });
});

describe("planWeekLineage", () => {
  it("does not depend on the order slots arrive in", () => {
    const a = planWeekLineage([{ id: "plan-s2-2026-07-28" }, { id: "plan-s1-2026-07-27" }]);
    const b = planWeekLineage([{ id: "plan-s1-2026-07-27" }, { id: "plan-s2-2026-07-28" }]);
    expect(a).toBe(b);
  });

  it("separates weeks with different placements", () => {
    expect(planWeekLineage([{ id: "plan-s1-2026-07-27" }])).not.toBe(
      planWeekLineage([{ id: "plan-s1-2026-07-28" }]),
    );
  });

  it("is empty for an empty week, which is a legitimate plan", () => {
    expect(planWeekLineage([])).toBe("");
  });
});

describe("shouldApplyWeek", () => {
  const rank = (over: Partial<PlanWeekRank> = {}): PlanWeekRank => ({
    updatedAt: "2026-07-30T10:00:00",
    version: 4,
    lineage: "plan-s1-2026-07-27",
    ...over,
  });

  it("takes the later week regardless of version", () => {
    // Device B was offline longer and is on a lower version, but wrote last.
    const local = rank({ updatedAt: "2026-07-30T09:00:00", version: 9 });
    const incoming = rank({ updatedAt: "2026-07-30T10:00:00", version: 2 });
    expect(shouldApplyWeek(local, incoming)).toBe(true);
  });

  it("uses version to break an updatedAt tie", () => {
    expect(shouldApplyWeek(rank({ version: 4 }), rank({ version: 5 }))).toBe(true);
    expect(shouldApplyWeek(rank({ version: 5 }), rank({ version: 4 }))).toBe(false);
  });

  it("resolves the double tie deterministically, and in one direction only", () => {
    // Both devices open the app in the same second and relayout the same week: same
    // updatedAt, both at version 5. Without the third key each device keeps its own
    // week forever, silently — which is exactly what D45 says must not happen.
    const a = rank({ version: 5, lineage: "plan-s1-2026-07-27" });
    const b = rank({ version: 5, lineage: "plan-s2-2026-07-27" });

    expect(shouldApplyWeek(a, b)).toBe(true);
    expect(shouldApplyWeek(b, a)).toBe(false);
  });

  it("is a no-op when the week is genuinely identical", () => {
    // The normal case: the server echoing back the week this device just pushed.
    expect(shouldApplyWeek(rank(), rank())).toBe(false);
  });

  it("applies when the device has no week for that start", () => {
    expect(shouldApplyWeek(null, rank())).toBe(true);
  });

  it("is a total order, so both devices land on the same week", () => {
    const weeks: PlanWeekRank[] = [
      { updatedAt: "2026-07-30T09:00:00", version: 1, lineage: "a" },
      { updatedAt: "2026-07-30T10:00:00", version: 1, lineage: "a" },
      { updatedAt: "2026-07-30T10:00:00", version: 2, lineage: "a" },
      { updatedAt: "2026-07-30T10:00:00", version: 2, lineage: "b" },
    ];

    for (const x of weeks) {
      for (const y of weeks) {
        // Antisymmetric: exactly one of "x wins" / "y wins" holds unless they are equal.
        const xy = comparePlanWeek(x, y);
        const yx = comparePlanWeek(y, x);
        expect(Math.sign(xy) + Math.sign(yx)).toBe(0);
        expect(shouldApplyWeek(x, y) && shouldApplyWeek(y, x)).toBe(false);
      }
    }
  });
});
