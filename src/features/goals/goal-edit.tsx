"use client";

import { useLiveQuery } from "dexie-react-hooks";

import { getGoalsWithStage } from "@/db/local/queries";
import { GoalForm } from "@/features/goals/goal-form";

export function GoalEdit({ goalId }: { goalId: string }) {
  // No single-goal read exists in queries.ts, so this reuses the bounded
  // all-goals-with-stage read (goals are capped by D11) and finds the one we want.
  const goals = useLiveQuery(() => getGoalsWithStage(), []);

  if (goals === undefined) {
    return <p className="text-body text-text-muted">Loading…</p>;
  }

  const found = goals.find((g) => g.goal.id === goalId);
  if (!found || !found.stage) {
    return <p className="text-body text-text-muted">Goal not found.</p>;
  }

  return <GoalForm existing={{ goal: found.goal, stage: found.stage }} />;
}
