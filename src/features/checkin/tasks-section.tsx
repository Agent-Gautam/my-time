"use client";

// Tasks on Today — one section, separate from the daypart carousel above it. Every
// daypart's tasks show together here, grouped and ordered by daypart (`getDayparts()`
// is already sorted by `sortOrder`), so browsing the carousel never hides or reveals
// a task — this section doesn't change with which daypart is being viewed.
//
// **Adding a task now asks which daypart it belongs to.** When this lived inside
// `DaypartPanel`, the daypart was implicit — whichever card the form was opened in.
// Split out as its own section, there is no longer an implicit answer, so the picker
// is a new required field rather than an optional one.

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

import type { IsoDateTime, TaskStatus } from "@/core/types";
import { getGoalsWithStage, getTasksForDaypart } from "@/db/local/queries";
import { putTask, setTaskStatus } from "@/db/local/mutations";
import type { LocalDaypart, LocalTask } from "@/db/local/schema";
import { currentDaypart, daypartDate, localNow } from "@/lib/daypart";
import { formatDuration } from "@/lib/duration";

import { capitalize } from "./lib";

const NO_GOAL = "none";

/** The opening time-box for a new task. Most one-off tasks are short, and a field
 *  that starts at a plausible number is faster to correct than one that starts empty. */
const DEFAULT_TASK_MINUTES = 15;

export function TasksSection({
  dayparts,
  now,
}: {
  dayparts: LocalDaypart[];
  now: IsoDateTime;
}) {
  // `daypartDate` is resolved per daypart, never once for the section: it returns
  // *yesterday* for the post-midnight half of a wrapping night daypart
  // (`lib/daypart.ts`), so one shared date would read the wrong day's tasks at 2am.
  //
  // The dep is derived from the ids rather than the array itself — `dayparts` is a
  // fresh array on every upstream `liveQuery` emission, so passing its identity
  // resubscribes all four queries on every unrelated write.
  const daypartKey = dayparts.map((dp) => dp.id).join("|");
  const tasksByDaypart = useLiveQuery(
    () => Promise.all(dayparts.map((dp) => getTasksForDaypart(daypartDate(dp, now), dp.id))),
    [daypartKey, now],
    [] as LocalTask[][],
  );

  // Options for the optional goal picker (D70).
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
  // `<SelectValue>` falls back to rendering the raw `value` (the goal's/daypart's id)
  // instead of its name once one is picked.
  const goalSelectItems: Record<string, string> = { [NO_GOAL]: "No goal" };
  for (const g of goalsWithStage) {
    if (g.stage != null) goalSelectItems[g.goal.id] = g.goal.name;
  }
  const daypartSelectItems: Record<string, string> = {};
  for (const dp of dayparts) daypartSelectItems[dp.id] = capitalize(dp.name);

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(DEFAULT_TASK_MINUTES);
  const [goalId, setGoalId] = useState(NO_GOAL);
  // Defaults to the daypart the clock is actually in, not the first in `sortOrder` —
  // opening the form at 9pm and having it pre-filled with "morning" files the task
  // into an occurrence that is already over. Read from `now`, not from the carousel's
  // viewed daypart: this section is page-level and must not depend on carousel state.
  const defaultDaypartId = () => currentDaypart(dayparts, now)?.id ?? dayparts[0]?.id ?? "";
  const [daypartId, setDaypartId] = useState(defaultDaypartId);
  const [saving, setSaving] = useState(false);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  const add = async () => {
    const trimmed = title.trim();
    const daypart = dayparts.find((dp) => dp.id === daypartId);
    if (trimmed === "" || !daypart || saving) return;
    setSaving(true);
    try {
      const at = localNow();
      const stageId =
        goalId === NO_GOAL
          ? null
          : (goalsWithStage.find((g) => g.goal.id === goalId)?.stage?.id ?? null);
      await putTask(
        {
          title: trimmed,
          minutes,
          date: daypartDate(daypart, at),
          daypartId: daypart.id,
          stageId,
        },
        at,
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

  const hasAnyTasks = tasksByDaypart.some((tasks) => tasks.length > 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-title font-semibold text-ink">Tasks</h2>
        {!adding && (
          <Button
            variant="ghost"
            size="sm"
            className="text-label h-auto shrink-0 px-2 py-1"
            onClick={() => {
              setDaypartId(defaultDaypartId());
              setAdding(true);
            }}
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

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-daypart">Which daypart?</Label>
              <Select
                items={daypartSelectItems}
                value={daypartId}
                onValueChange={(value) => setDaypartId(value ?? "")}
              >
                <SelectTrigger id="task-daypart" className="w-full">
                  <SelectValue placeholder="Choose a daypart" />
                </SelectTrigger>
                <SelectContent>
                  {dayparts.map((dp) => (
                    <SelectItem key={dp.id} value={dp.id}>
                      {capitalize(dp.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
                disabled={title.trim() === "" || daypartId === "" || saving}
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
      {!adding && !hasAnyTasks && (
        <p className="text-body text-text-muted">Nothing on its own today.</p>
      )}

      {dayparts.map((dp, index) => {
        const tasks = tasksByDaypart[index] ?? [];
        if (tasks.length === 0) return null;
        const pending = tasks.filter((task) => task.status === "pending");
        const answered = tasks.filter((task) => task.status !== "pending");

        return (
          <div key={dp.id} className="flex flex-col gap-2">
            <h3 className="text-label font-medium text-text-muted">{capitalize(dp.name)}</h3>

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

            {/* Answered tasks stay on screen for the rest of the occurrence,
                read-only. A skip is reported in the same neutral grey as
                everything else on /missed — nothing here is a verdict (D15). */}
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
          </div>
        );
      })}
    </section>
  );
}
