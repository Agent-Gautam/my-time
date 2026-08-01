"use client";

// Active and planned goals, with free-slot counts per daypart always visible
// (D31) — capacity is a ceiling, never a target, so this only ever reports the
// fact ("evening: 2 of 3 slots used"), never nudges the user to fill it (D21).
//
// The capacity numbers come from the **plan**, not from how many goals declare a
// daypart eligible (D60). Two numbers rather than one: today's occupancy is concrete,
// but "can I start another goal in the evening?" is answered by how many days of the
// week still have room — a daypart can be full tonight and open on four other days.

import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getDayparts,
  getDaypartCapacity,
  getGoalsWithStage,
  type DaypartCapacity,
} from "@/db/local/queries";
import { putGoal } from "@/db/local/mutations";
import { relayoutWeek } from "@/features/plan/planner";
import { localNow } from "@/lib/daypart";
import { formatDuration } from "@/lib/duration";
import type { LocalGoal } from "@/db/local/schema";

const TIER_LABEL: Record<number, string> = {
  1: "Critical",
  2: "Normal",
  3: "Background",
};

/**
 * States the fact, never the suggestion (D21). "Room on N more days" is a count, not
 * an invitation — there is deliberately no call to action anywhere in this string.
 */
function describeCapacity(cap: DaypartCapacity): string {
  const today = `${cap.usedToday} of ${cap.activeCap} today`;
  if (cap.activeCap === 0) return "closed";
  if (cap.freeDays === 0) return `${today} · full all week`;
  return `${today} · room on ${cap.freeDays} of ${cap.windowDays} days`;
}

export function GoalsList() {
  // Read once at mount, not per render: this drives a read-only summary, and a value
  // that changes identity on every render would re-run the live query forever. Writes
  // elsewhere re-read `localNow()` at the moment of the action (D53).
  const [now] = useState(localNow);
  const dayparts = useLiveQuery(() => getDayparts(), []);
  const capacity = useLiveQuery(() => getDaypartCapacity(now), [now]);
  const goals = useLiveQuery(
    () => getGoalsWithStage({ states: ["active", "planned"] }),
    [],
  );
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const capacityByDaypart = new Map((capacity ?? []).map((c) => [c.daypartId, c]));

  // Manual promotion only (D31) — this never fires on its own, and it never
  // suggests capacity is something to fill (D21). "dropped" isn't reachable here;
  // that's a destructive action that stays behind the edit form (D48).
  async function toggleGoalState(goal: LocalGoal, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (togglingId) return;
    setTogglingId(goal.id);
    try {
      // Fresh read for the write (D53) — distinct from the mount-time `now` above,
      // which only drives the read-only capacity summary.
      const actionNow = localNow();
      const nextState = goal.state === "planned" ? "active" : "planned";
      await putGoal({ ...goal, state: nextState }, actionNow);
      await relayoutWeek({ now: actionNow });
      toast.success(nextState === "active" ? "Goal moved to active." : "Goal moved to planned.");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-section font-semibold text-text">Capacity</h2>
        <p className="text-label text-text-subtle">
          How many different goals each part of the day is holding, from the current
          plan.
        </p>
        <div className="flex flex-wrap gap-2">
          {(dayparts ?? []).map((daypart) => {
            const cap = capacityByDaypart.get(daypart.id);
            return (
              <Badge key={daypart.id} variant="secondary" className="capitalize">
                {daypart.name}:{" "}
                <span className="normal-case">
                  {cap ? describeCapacity(cap) : "…"}
                </span>
              </Badge>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-section font-semibold text-text">Goals</h2>
          <Button size="sm" render={<Link href="/goals/new" />}>
            <Plus />
            New goal
          </Button>
        </div>

        {goals === undefined ? (
          <p className="text-body text-text-muted">Loading…</p>
        ) : goals.length === 0 ? (
          <p className="text-body text-text-muted">
            No goals yet. Create one to start building a plan.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {goals.map(({ goal, stage }) => (
              <Link key={goal.id} href={`/goals/${goal.id}`}>
                <Card className="transition-colors hover:bg-surface-2">
                  <CardContent className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={
                          goal.tier === 1
                            ? "text-body font-semibold text-accent-text"
                            : goal.tier === 3
                              ? "text-body text-text-muted"
                              : "text-body text-text"
                        }
                      >
                        {goal.name}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={goal.state === "planned" ? "outline" : "secondary"}>
                          {goal.state === "planned" ? "Planned" : "Active"}
                        </Badge>
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={togglingId === goal.id}
                          onClick={(e) => toggleGoalState(goal, e)}
                        >
                          {goal.state === "planned" ? "Move to active" : "Move to planned"}
                        </Button>
                      </div>
                    </div>
                    <span className="text-label text-text-subtle">
                      {TIER_LABEL[goal.tier] ?? "Normal"}
                      {stage ? ` · ${formatDuration(stage.sessionMinutes)} · ${describeCadence(stage.cadenceType, stage.cadenceCount)}` : ""}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function describeCadence(cadenceType: string, cadenceCount: number): string {
  if (cadenceType === "fixed_days") return `${cadenceCount}× fixed days/week`;
  if (cadenceType === "hybrid") return `${cadenceCount}×/week, hybrid`;
  return `${cadenceCount}×/week`;
}
