"use client";

// One-off tasks on Today (D68) — a time-box that belongs to no goal, or optionally
// attached to one (D70).
//
// It behaves like a session and deliberately not like a to-do item: it is anchored to
// this daypart occurrence, it is answered Done or Skipped, and when the daypart ends
// unanswered it is missed and dies there (D20). There is no priority, no due date and
// nothing carries forward — which is the whole reason PRD §1's "not a to-do app" still
// holds with this on the screen.
//
// **Attaching a goal is optional and changes nothing about the mechanics here (D70).**
// Leaving the picker unset is the exact D68 stray path. Picking one attaches the task
// to that goal's stage; when it's later marked Done, `setTaskStatus` (mutations.ts)
// pairs it with a voluntary session log on that stage — this component doesn't need to
// know that happens, it just calls the same `setTaskStatus` it always has.
//
// **Clock reads follow the D53 convention used everywhere on this screen**: `date` for
// reads is the occurrence date the parent already resolved, but every write re-reads
// `localNow()` and re-derives `daypartDate` at the moment of the tap — a PWA tab
// resumed hours later must not file a task against the daypart it was opened in.

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DurationField } from "@/components/duration-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { IsoDate, TaskStatus } from "@/core/types";
import { getGoalsWithStage, getTasksForDaypart } from "@/db/local/queries";
import { putTask, setTaskStatus } from "@/db/local/mutations";
import type { LocalDaypart, LocalTask } from "@/db/local/schema";
import { daypartDate, localNow } from "@/lib/daypart";
import { formatDuration } from "@/lib/duration";

const NO_GOAL = "none";

/** The opening time-box for a new task. Most one-off tasks are short, and a field
 *  that starts at a plausible number is faster to correct than one that starts empty. */
const DEFAULT_TASK_MINUTES = 15;

export function TaskList({
  daypart,
  occurrenceDate,
}: {
  daypart: LocalDaypart;
  occurrenceDate: IsoDate;
}) {
  const tasks = useLiveQuery(
    () => getTasksForDaypart(occurrenceDate, daypart.id),
    [occurrenceDate, daypart.id],
    [] as LocalTask[],
  );

  // Options for the optional goal picker (D70) — the same active-goals-with-stage
  // read `voluntaryCandidates` already makes elsewhere, so no new query shape.
  const goalsWithStage = useLiveQuery(
    () => getGoalsWithStage({ states: ["active"] }),
    [],
    [] as Awaited<ReturnType<typeof getGoalsWithStage>>,
  );
  const goalNameByStageId = new Map(
    goalsWithStage.filter((g) => g.stage != null).map((g) => [g.stage!.id, g.goal.name]),
  );

  // Base UI's `<Select>` — unlike Radix — doesn't derive the trigger's label from
  // the matched `SelectItem`'s children; it needs this explicit value→label map, or
  // `<SelectValue>` falls back to rendering the raw `value` (the goal's id) instead
  // of its name once one is picked.
  const goalSelectItems: Record<string, string> = { [NO_GOAL]: "No goal" };
  for (const g of goalsWithStage) {
    if (g.stage != null) goalSelectItems[g.goal.id] = g.goal.name;
  }

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(DEFAULT_TASK_MINUTES);
  const [goalId, setGoalId] = useState(NO_GOAL);
  const [saving, setSaving] = useState(false);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  const pending = tasks.filter((task) => task.status === "pending");
  const answered = tasks.filter((task) => task.status !== "pending");

  const add = async () => {
    const trimmed = title.trim();
    if (trimmed === "" || saving) return;
    setSaving(true);
    try {
      const now = localNow();
      const stageId =
        goalId === NO_GOAL
          ? null
          : (goalsWithStage.find((g) => g.goal.id === goalId)?.stage?.id ?? null);
      await putTask(
        {
          title: trimmed,
          minutes,
          date: daypartDate(daypart, now),
          daypartId: daypart.id,
          stageId,
        },
        now,
      );
      setTitle("");
      setMinutes(DEFAULT_TASK_MINUTES);
      setGoalId(NO_GOAL);
      setAdding(false);
    } finally {
      setSaving(false);
    }
  };

  const answer = async (task: LocalTask, status: TaskStatus) => {
    setPendingIds((prev) => new Set(prev).add(task.id));
    try {
      // No `relayoutWeek` here, unlike logging a session: a task was never in the
      // plan, so there is nothing for the scheduler to recompute (D68).
      await setTaskStatus(task.id, status, localNow());
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-title font-semibold text-ink">Tasks</h2>
        {!adding && (
          <Button
            variant="ghost"
            size="sm"
            className="text-label h-auto shrink-0 px-2 py-1"
            onClick={() => setAdding(true)}
          >
            Add a task
          </Button>
        )}
      </div>

      {adding && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-title">What is it?</Label>
              <Input
                id="task-title"
                value={title}
                autoFocus
                placeholder="Renew the passport"
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void add();
                }}
              />
            </div>
            <DurationField idPrefix="task" value={minutes} onChange={setMinutes} />

            {/* Optional (D70) — leaving this unset is the exact D68 stray path. */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-goal">Attach to a goal (optional)</Label>
              <Select
                items={goalSelectItems}
                value={goalId}
                onValueChange={(value) => setGoalId(value ?? NO_GOAL)}
              >
                <SelectTrigger id="task-goal" className="w-full">
                  <SelectValue placeholder="No goal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GOAL}>No goal</SelectItem>
                  {goalsWithStage
                    .filter((g) => g.stage != null)
                    .map((g) => (
                      <SelectItem key={g.goal.id} value={g.goal.id}>
                        {g.goal.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button
                className="min-h-11 flex-1"
                disabled={title.trim() === "" || saving}
                onClick={add}
              >
                Add
              </Button>
              <Button
                variant="outline"
                className="min-h-11 flex-1"
                disabled={saving}
                onClick={() => {
                  setAdding(false);
                  setTitle("");
                  setGoalId(NO_GOAL);
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Capacity is a ceiling, not a target (D21) — an empty task list is stated
          plainly and is never a prompt to fill it. The "Add a task" button above is
          already the whole affordance; a second sentence inviting its use would be
          exactly the nagging that rule forbids. */}
      {!adding && pending.length === 0 && answered.length === 0 && (
        <p className="text-body text-text-muted">Nothing on its own today.</p>
      )}

      {pending.map((task) => (
        <Card key={task.id}>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-section font-semibold text-ink">{task.title}</p>
                {task.stageId && goalNameByStageId.has(task.stageId) && (
                  <p className="text-label text-text-muted">
                    {goalNameByStageId.get(task.stageId)}
                  </p>
                )}
              </div>
              <span className="numeric shrink-0 text-label text-text-muted">
                {formatDuration(task.minutes)}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                className="min-h-11 flex-1 transition-transform duration-150 ease-out active:scale-95"
                disabled={pendingIds.has(task.id)}
                onClick={() => answer(task, "done")}
              >
                Done
              </Button>
              <Button
                variant="outline"
                className="min-h-11 flex-1 transition-transform duration-150 ease-out active:scale-95"
                disabled={pendingIds.has(task.id)}
                onClick={() => answer(task, "skipped")}
              >
                Skipped
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Answered tasks stay on screen for the rest of the occurrence, read-only.
          A skip is reported in the same neutral grey as everything else on /missed —
          nothing here is a verdict (D15). */}
      {answered.map((task) => (
        <div
          key={task.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
        >
          <div>
            <p className="text-body text-text-muted">{task.title}</p>
            <p className="text-label text-text-subtle">
              {task.status === "done" ? "Done" : "Skipped"}
              {task.stageId && goalNameByStageId.has(task.stageId)
                ? ` · ${goalNameByStageId.get(task.stageId)}`
                : ""}
            </p>
          </div>
          <span className="numeric text-label text-text-subtle">
            {formatDuration(task.minutes)}
          </span>
        </div>
      ))}
    </section>
  );
}
