"use client";

// The goal detail screen (PRD §6.7): the same pace numbers as Today, given room
// to breathe, plus this goal's session history and — for scoped goals — its
// checkpoint history.
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { getGoalsWithStage } from "@/db/local/queries";
import { localNow } from "@/lib/daypart";
import { PaceSummary } from "./pace-summary";
import { SessionHistory } from "./session-history";
import { CheckpointHistory } from "./checkpoint-history";

export function GoalDetail({ goalId }: { goalId: string }) {
  // No single-goal read exists in queries.ts (same note as GoalEdit) — reuses the
  // bounded all-goals-with-stage read (goals are capped by D11).
  const goals = useLiveQuery(() => getGoalsWithStage(), []);
  const [initialNow] = useState(() => localNow());

  if (goals === undefined) {
    return <p className="text-body text-text-muted">Loading…</p>;
  }

  const found = goals.find((g) => g.goal.id === goalId);
  if (!found || !found.stage) {
    return <p className="text-body text-text-muted">Goal not found.</p>;
  }

  const { goal, stage } = found;
  const isScoped = stage.scopeUnitTotal != null && stage.targetDate != null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title font-semibold text-ink">{goal.name}</h1>

      <PaceSummary stage={stage} now={initialNow} />
      <SessionHistory stageId={stage.id} />
      {isScoped && stage.scopeUnitLabel && (
        <CheckpointHistory stageId={stage.id} unitLabel={stage.scopeUnitLabel} />
      )}
    </div>
  );
}
