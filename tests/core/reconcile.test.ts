import { describe, expect, it } from "vitest";
import { reconcileDaypart } from "@/core/reconcile";
import type { PlanSlot } from "@/core/types";

function slot(id: string, minutes: number): PlanSlot {
  return { id, stageId: id, weekStart: "2026-07-27", date: "2026-07-30", daypartId: "morning", minutes };
}

const NOW = "2026-07-30T09:00:00.000Z";

describe("reconcileDaypart", () => {
  it("keeps everything when it all fits", () => {
    const slots = [slot("a", 30), slot("b", 20)];
    const { keep, dropped } = reconcileDaypart({ slots, availableMinutes: 60, now: NOW });
    expect(keep.map((s) => s.id).sort()).toEqual(["a", "b"]);
    expect(dropped).toEqual([]);
  });

  it("drops everything when nothing fits", () => {
    const slots = [slot("a", 45)];
    const { keep, dropped } = reconcileDaypart({ slots, availableMinutes: 30, now: NOW });
    expect(keep).toEqual([]);
    expect(dropped.map((s) => s.id)).toEqual(["a"]);
  });

  it("prefers three higher-priority 30-minute sessions over one lower-priority 60-minute session in 90 minutes (rule 6 worked example)", () => {
    // index 0 = highest priority in the input ordering
    const slots = [slot("s1", 30), slot("s2", 30), slot("s3", 30), slot("big", 60)];
    const { keep, dropped } = reconcileDaypart({ slots, availableMinutes: 90, now: NOW });
    expect(keep.map((s) => s.id).sort()).toEqual(["s1", "s2", "s3"]);
    expect(dropped.map((s) => s.id)).toEqual(["big"]);
  });

  it("never splits a session — no partial sessions even when it would improve the fit (D12, D27)", () => {
    const slots = [slot("a", 40)];
    const { keep, dropped } = reconcileDaypart({ slots, availableMinutes: 39, now: NOW });
    expect(keep).toEqual([]);
    expect(dropped.map((s) => s.id)).toEqual(["a"]);
  });

  it("finds the exact-optimal packing rather than a greedy priority-order truncation", () => {
    // Greedy-by-priority would take "a" (50, highest priority) then have 40 left,
    // which fits nothing else (b=45, c=45) — wasting 40 minutes.
    // The optimal packing takes b + c (90) instead, using the full 90 available.
    const slots = [slot("a", 50), slot("b", 45), slot("c", 45)];
    const { keep, dropped } = reconcileDaypart({ slots, availableMinutes: 90, now: NOW });
    expect(keep.map((s) => s.id).sort()).toEqual(["b", "c"]);
    expect(dropped.map((s) => s.id)).toEqual(["a"]);
  });

  it("returns everything dropped and nothing kept when availableMinutes is zero", () => {
    const slots = [slot("a", 30)];
    const { keep, dropped } = reconcileDaypart({ slots, availableMinutes: 0, now: NOW });
    expect(keep).toEqual([]);
    expect(dropped.map((s) => s.id)).toEqual(["a"]);
  });

  it("handles an empty slot list", () => {
    const { keep, dropped } = reconcileDaypart({ slots: [], availableMinutes: 60, now: NOW });
    expect(keep).toEqual([]);
    expect(dropped).toEqual([]);
  });
});
