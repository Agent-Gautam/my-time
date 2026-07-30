"use client";

// Active and planned goals, with free-slot counts per daypart always visible
// (D31) — capacity is a ceiling, never a target, so this only ever reports the
// fact ("evening: 2 of 3 slots used"), never nudges the user to fill it (D21).

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDayparts, getDaypartCapacity, getGoalsWithStage } from "@/db/local/queries";

const TIER_LABEL: Record<number, string> = {
  1: "Critical",
  2: "Normal",
  3: "Background",
};

export function GoalsList() {
  const dayparts = useLiveQuery(() => getDayparts(), []);
  const capacity = useLiveQuery(() => getDaypartCapacity(), []);
  const goals = useLiveQuery(
    () => getGoalsWithStage({ states: ["active", "planned"] }),
    [],
  );

  const capacityByDaypart = new Map((capacity ?? []).map((c) => [c.daypartId, c]));

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-section font-semibold text-text">Capacity</h2>
        <div className="flex flex-wrap gap-2">
          {(dayparts ?? []).map((daypart) => {
            const cap = capacityByDaypart.get(daypart.id);
            return (
              <Badge key={daypart.id} variant="secondary" className="capitalize">
                {daypart.name}: {cap ? `${cap.used} of ${cap.activeCap} used` : "…"}
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
                      <Badge variant={goal.state === "planned" ? "outline" : "secondary"}>
                        {goal.state === "planned" ? "Planned" : "Active"}
                      </Badge>
                    </div>
                    <span className="text-label text-text-subtle">
                      {TIER_LABEL[goal.tier] ?? "Normal"}
                      {stage ? ` · ${stage.sessionMinutes} min · ${describeCadence(stage.cadenceType, stage.cadenceCount)}` : ""}
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
