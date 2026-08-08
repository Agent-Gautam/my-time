"use client";

// One daypart's whole card on Today (D71, revised to a carousel) — only the viewed
// daypart's card renders at all; the header carries the prev/next arrows that switch
// which one is viewed. Its stat grid, duration field and submit button live inline
// here, per daypart, same as `AdjustToday`'s old sheet did, just addressed by
// whichever daypart is being viewed rather than always "the current one."
//
// **The viewed daypart always renders its full body — there is no expand/collapse.**
// A carousel shows exactly one card; there's nothing left to accordion. Position
// (`past`/`current`/`future`, relative to the *actual* current daypart, not the one
// being viewed) still drives the tint-only dim treatment below, so browsing to a
// neighboring daypart reads as "not the one you're acting on right now" without any
// text saying so.
import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DurationField } from "@/components/duration-field";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import type { IsoDateTime } from "@/core/types";
import {
  daypartContains,
  daypartDate,
  daypartEndsAt,
  daypartLengthMinutes,
  minutesRemainingIn,
} from "@/lib/daypart";
import { formatDuration } from "@/lib/duration";
import {
  getLatestCheckIn,
  getLatestCheckpoint,
  getSessionLogsForDaypart,
  getTasksForDaypart,
} from "@/db/local/queries";
import { logSession, putCheckIn, putTask } from "@/db/local/mutations";
import type { LocalDaypart, LocalStage } from "@/db/local/schema";
import {
  reconcileNow,
  relayoutWeek,
  type ReconciledSlot,
} from "@/features/plan/planner";
import { useLiveQuery } from "dexie-react-hooks";

import type { CheckpointTarget } from "./checkpoint-prompt";
import { SessionCard } from "./session-card";
import {
  capitalize,
  formatClockTime,
  requiredMinutesForDaypart,
  shouldPromptCheckpoint,
} from "./lib";

export type DaypartPosition = "past" | "current" | "future";

/**
 * Position styling composed entirely from existing semantic tokens (D52) — no new
 * colours. Past and future are told apart *only* by tint (neutral/cool vs.
 * accent/warm), never by text (D71) — the requested "back glow" is a soft tinted
 * wash plus a matching ring, not a blur or `backdrop-filter` (§6.1 bans those
 * specifically for Android GPU cost; a translucent fill isn't in that category).
 */
const POSITION_CLASSES: Record<DaypartPosition, string> = {
  current: "opacity-100 shadow-md ring-1 ring-accent-fill/30",
  past: "opacity-70 bg-neutral/5 ring-1 ring-neutral/15",
  future: "opacity-70 bg-accent-fill/5 ring-1 ring-accent-fill/15",
};

export function DaypartPanel({
  daypart,
  now,
  position,
  daypartWasChanged,
  onSetCurrent,
  onCheckpointDue,
  onPrev,
  onNext,
}: {
  daypart: LocalDaypart;
  now: IsoDateTime;
  position: DaypartPosition;
  /** True only for the current daypart, when it was set by "Set current" rather
   *  than detected — mirrors the old "(you changed this)" indicator. */
  daypartWasChanged: boolean;
  onSetCurrent: () => void;
  onCheckpointDue: (target: CheckpointTarget) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const occurrenceDate = daypartDate(daypart, now);

  const requiredMinutes = useLiveQuery(
    () => requiredMinutesForDaypart(occurrenceDate, daypart.id),
    [occurrenceDate, daypart.id],
  );

  const checkInState = useLiveQuery(
    () => getLatestCheckIn(occurrenceDate, daypart.id).then((row) => ({ row })),
    [occurrenceDate, daypart.id],
  );
  const storedCheckIn = checkInState?.row;

  const [clearedFor, setClearedFor] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const occurrenceKey = `${occurrenceDate}|${daypart.id}`;
  const statedMinutes =
    clearedFor === occurrenceKey
      ? null
      : (storedCheckIn?.availableMinutes ?? null);

  const spentMinutes = useLiveQuery(
    () =>
      Promise.all([
        getSessionLogsForDaypart(occurrenceDate, daypart.id),
        getTasksForDaypart(occurrenceDate, daypart.id),
      ]).then(([logs, tasks]) =>
        [
          ...logs.filter((log) => log.status === "done"),
          ...tasks.filter((task) => task.status === "done"),
        ].reduce((sum, row) => sum + row.minutes, 0),
      ),
    [occurrenceDate, daypart.id],
  );

  const remainingMinutes =
    statedMinutes == null
      ? null
      : Math.max(statedMinutes - (spentMinutes ?? 0), 0);

  const reconciled = useLiveQuery(
    () =>
      reconcileNow({
        now,
        daypartId: daypart.id,
        availableMinutes: remainingMinutes,
      }),
    [daypart.id, remainingMinutes, now],
  );

  const [pendingSlotIds, setPendingSlotIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [saving, setSaving] = useState(false);

  const openingBid = daypartContains(daypart, now)
    ? minutesRemainingIn(daypart, now)
    : daypartLengthMinutes(daypart);
  // Seeded once per mount, same as `AdjustToday` originally did — the parent keys
  // this component by `daypart.id`, so it doesn't remount on every render, but the
  // rare case of a tab kept open across a midnight occurrence rollover reseeding
  // this field is an edge case, not a regression: the original component had the
  // exact same one-time-seed behavior, just reset via a `key` prop instead.
  const [minutes, setMinutes] = useState(statedMinutes ?? openingBid);

  const promptCheckpointIfDue = async (
    stage: LocalStage,
    goalName: string,
    at: string,
  ) => {
    if (
      !stage.scopeUnitLabel ||
      stage.scopeUnitTotal == null ||
      stage.targetDate == null
    ) {
      return;
    }
    const latest = await getLatestCheckpoint(stage.id);
    if (shouldPromptCheckpoint(at, latest?.loggedAt)) {
      onCheckpointDue({
        stageId: stage.id,
        goalName,
        unitLabel: stage.scopeUnitLabel,
        now: at,
      });
    }
  };

  const logSlot = async (
    slot: ReconciledSlot,
    status: "done" | "skipped",
    taskTitle?: string,
  ) => {
    setPendingSlotIds((prev) => new Set(prev).add(slot.slot.id));
    try {
      const at = now;
      const date = daypartDate(daypart, at);

      let taskId: string | null = null;
      if (status === "done" && taskTitle?.trim()) {
        const task = await putTask(
          {
            title: taskTitle.trim(),
            minutes: slot.slot.minutes,
            date,
            daypartId: daypart.id,
            stageId: slot.stage.id,
            status: "done",
            resolvedAt: at,
          },
          at,
        );
        taskId = task.id;
      }

      await logSession(
        {
          stageId: slot.stage.id,
          date,
          daypartId: daypart.id,
          minutes: slot.slot.minutes,
          status,
          source: "planned",
          taskId,
        },
        at,
      );
      await relayoutWeek({ now: at });

      if (status === "done")
        await promptCheckpointIfDue(slot.stage, slot.goal.name, at);
    } finally {
      setPendingSlotIds((prev) => {
        const next = new Set(prev);
        next.delete(slot.slot.id);
        return next;
      });
    }
  };

  const reschedule = async () => {
    if (!Number.isFinite(minutes) || minutes < 0) return;
    setSaving(true);
    try {
      const date = daypartDate(daypart, now);
      await putCheckIn(
        { daypartId: daypart.id, availableMinutes: minutes, date },
        now,
      );
      setClearedFor(null);
    } finally {
      setSaving(false);
    }
  };

  const showEverythingAgain = async () => {
    setClearedFor(occurrenceKey);
    setMinutes(openingBid);
  };

  return (
    <div className="relative">
      {position === "current" && (
        <div
          className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-accent-fill/30 via-accent-fill/60 to-accent-fill/30 blur-md opacity-75 shimmer-glow pointer-events-none"
          aria-hidden="true"
        />
      )}
      <Card
        className={cn(
          "relative transition-[transform,opacity] duration-200 ease-out bg-surface",
          POSITION_CLASSES[position],
        )}
      >
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            aria-label="Previous daypart"
            onClick={onPrev}
          >
            <ChevronLeftIcon />
          </Button>

          <div className="flex flex-1 flex-col items-center gap-0.5 sm:flex-row sm:justify-center sm:gap-1.5">
            <div className="flex items-center gap-1.5">
              <p className="text-section font-semibold text-ink">
                {capitalize(daypart.name)}
              </p>
              {position === "current" && daypartWasChanged && (
                <span className="text-label font-normal text-text-muted">
                  (you changed this)
                </span>
              )}
            </div>
            <span className="hidden text-label text-text-muted sm:inline">
              ·
            </span>
            <div className="flex items-center gap-1">
              <p className="numeric text-label text-text-muted">
                {daypart.startTime}–{daypart.endTime}
              </p>
              {position === "current" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 rounded-full p-0 text-text-muted hover:text-text"
                  aria-label={isExpanded ? "Collapse details" : "Expand details"}
                  onClick={() => setIsExpanded((prev) => !prev)}
                >
                  <ChevronDownIcon
                    className={cn(
                      "size-4 transition-transform duration-200",
                      isExpanded && "rotate-180"
                    )}
                  />
                </Button>
              )}
            </div>
            {position !== "current" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto px-1.5 py-0.5 text-label font-normal"
                onClick={onSetCurrent}
              >
                Set current
              </Button>
            )}
          </div>

          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            aria-label="Next daypart"
            onClick={onNext}
          >
            <ChevronRightIcon />
          </Button>
        </div>

        {position === "current" && (
          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-300 ease-in-out",
              isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            )}
          >
            <div className="overflow-hidden">
              <div className="flex flex-col gap-4 pb-1">
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-2 p-3 sm:grid-cols-4">
                  <Stat
                    label="Required"
                    value={formatDuration(requiredMinutes ?? 0)}
                  />
                  <Stat
                    label="Length"
                    value={formatDuration(daypartLengthMinutes(daypart))}
                  />
                  <Stat
                    label="Remaining"
                    value={
                      daypartContains(daypart, now)
                        ? formatDuration(minutesRemainingIn(daypart, now))
                        : "—"
                    }
                  />
                  <Stat
                    label="Ends at"
                    value={formatClockTime(daypartEndsAt(daypart, now))}
                  />
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-col gap-1.5">
                    <Label
                      htmlFor={`minutes-${daypart.id}`}
                      className="text-label text-text"
                    >
                      How much time do you have?
                    </Label>
                    <DurationField
                      idPrefix={`minutes-${daypart.id}`}
                      value={minutes}
                      onChange={setMinutes}
                      min={0}
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      className="min-h-11 flex-1 sm:flex-initial"
                      disabled={saving}
                      onClick={reschedule}
                    >
                      Reschedule
                    </Button>
                    {statedMinutes != null && (
                      <Button
                        variant="ghost"
                        className="min-h-11"
                        disabled={saving}
                        onClick={showEverythingAgain}
                      >
                        Show everything again
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

          <div className="flex flex-col gap-3">
            {reconciled &&
              reconciled.keep.length === 0 &&
              reconciled.dropped.length === 0 && (
                <p className="text-body text-text-muted">
                  Nothing planned for this daypart.
                </p>
              )}

            {reconciled?.keep.map((slot) => (
              <SessionCard
                key={slot.slot.id}
                slot={slot}
                pending={pendingSlotIds.has(slot.slot.id)}
                onLog={(status, taskTitle) => logSlot(slot, status, taskTitle)}
              />
            ))}

            {reconciled && reconciled.dropped.length > 0 && (
              <div className="flex flex-col gap-2 pt-2">
                <p className="text-label font-medium text-text-muted">
                  Won&apos;t fit today
                </p>
                {reconciled.dropped.map((slot) => (
                  <div
                    key={slot.slot.id}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                  >
                    <div>
                      <Link
                        href={`/goals/${slot.goal.id}`}
                        className="text-body text-text underline-offset-4 hover:underline"
                      >
                        {slot.goal.name}
                      </Link>
                      <p className="text-label text-text-muted">
                        {slot.reason}
                      </p>
                    </div>
                    <span className="numeric text-label text-text-muted">
                      {formatDuration(slot.slot.minutes)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
      </CardContent>
    </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption text-text-subtle">{label}</span>
      <span className="numeric text-section font-semibold text-ink">
        {value}
      </span>
    </div>
  );
}
