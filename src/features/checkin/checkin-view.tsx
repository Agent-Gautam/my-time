"use client";

// Today (PRD §6.5–§6.7, Architecture.md §9.2):
//   detect the daypart -> show the sessions the plan put there, with the gap stated
//   -> one tap per session logs it -> relayoutWeek regenerates future slots -> the
//   on-track summary, calmly.
//
// **Opening Today costs nothing (D62).** This screen used to be a gate: a form
// rendered first, and the session list did not exist until the user typed a number
// and pressed "Check in". Stating available time is now the explicit, occasional act
// of `<AdjustToday />`, for the days that are not ordinary. D8 is unchanged — the plan
// is still laid out ahead, reconciliation still happens when a time is stated, and
// D8's numbers are still visible immediately, now as the gap line below.
//
// **Clock reads (D53's convention, applied at every write site here):** the mount-time
// `initialNow` is a read-only convenience — it seeds the detected daypart and the
// numbers on screen, all of which the user reviews and can correct before anything is
// written. Every actual write — `putCheckIn`, `logSession`, `putCheckpoint` — calls
// `localNow()` fresh at the moment of that action instead of reusing a frozen value,
// so a tab left open and backgrounded for hours (the normal PWA resume pattern) cannot
// record a session against the wrong daypart or the wrong calendar day.
import { useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";

import { Button } from "@/components/ui/button";
import { DartLoader } from "@/components/dart-mark";

import {
  currentDaypart,
  daypartContains,
  daypartDate,
  daypartEndsAt,
  localNow,
  minutesRemainingIn,
} from "@/lib/daypart";
import { formatDuration } from "@/lib/duration";
import {
  getDayparts,
  getGoalsWithStage,
  getLatestCheckIn,
  getLatestCheckpoint,
  getSessionLogsForDaypart,
} from "@/db/local/queries";
import { logSession, putCheckIn } from "@/db/local/mutations";
import type { LocalStage } from "@/db/local/schema";
import { reconcileNow, relayoutWeek, type ReconciledSlot } from "@/features/plan/planner";

import { AdjustToday } from "./adjust-today";
import { CheckpointPrompt, type CheckpointTarget } from "./checkpoint-prompt";
import { GoalStatusRow } from "./goal-status-row";
import { SessionCard } from "./session-card";
import {
  capitalize,
  formatClockTime,
  requiredMinutesForDaypart,
  shouldPromptCheckpoint,
  voluntaryCandidates,
} from "./lib";

export function CheckinView() {
  const [initialNow] = useState(() => localNow());
  const dayparts = useLiveQuery(() => getDayparts(), [], []);
  const activeGoals = useLiveQuery(() => getGoalsWithStage({ states: ["active"] }), [], []);

  // `dayparts`/`activeGoals` default to `[]` while loading, which is
  // indistinguishable from "loaded, genuinely empty" — needed so the rest of
  // this component can treat them as plain arrays. This is a dedicated signal
  // for the one thing that actually needs to tell those states apart: the
  // first-paint loading indicator below.
  const dataReady = useLiveQuery(() => getDayparts().then(() => true), [], false);

  // Detected daypart is a derived value, not stored state — an override only
  // exists once the user actually corrects it (PRD §6.5: "confirms or corrects").
  const detectedDaypartId = currentDaypart(dayparts, initialNow)?.id ?? dayparts[0]?.id ?? null;
  const [daypartOverride, setDaypartOverride] = useState<string | null>(null);
  const selectedDaypartId = daypartOverride ?? detectedDaypartId;
  const selectedDaypart = dayparts.find((dp) => dp.id === selectedDaypartId) ?? null;

  // The occurrence's own date, which is yesterday's once a wrapping night daypart has
  // crossed midnight. Every read and write below keys off this, never `dateOnly(now)`
  // (D53) — checking in at 02:00 must not look at the wrong day's plan.
  const occurrenceDate = selectedDaypart ? daypartDate(selectedDaypart, initialNow) : null;
  const occurrenceKey =
    occurrenceDate && selectedDaypart ? `${occurrenceDate}|${selectedDaypart.id}` : null;

  const requiredMinutes = useLiveQuery(
    () =>
      occurrenceDate && selectedDaypart
        ? requiredMinutesForDaypart(occurrenceDate, selectedDaypart.id)
        : undefined,
    [occurrenceDate, selectedDaypart?.id],
  );

  // ---------------------------------------------------------------------------
  // Stated time — persisted, not React-only
  // ---------------------------------------------------------------------------
  // Held in the `checkIns` row rather than in component state, so a reload or a PWA
  // resume does not silently forget what the user said. `getLatestCheckIn` is bounded
  // on the `[date+daypartId]` index and already existed for exactly this.
  // Wrapped in an object for the same reason `dataReady` exists: `getLatestCheckIn`
  // resolves to `undefined` when the user has never stated a time, which is
  // indistinguishable from `useLiveQuery`'s own "still loading" undefined. Rendering
  // the list before this settles would show every session unpacked for a frame and
  // then re-pack it, on every load, for anyone who had stated a time.
  const checkInState = useLiveQuery(
    () =>
      occurrenceDate && selectedDaypart
        ? getLatestCheckIn(occurrenceDate, selectedDaypart.id).then((row) => ({ row }))
        : undefined,
    [occurrenceDate, selectedDaypart?.id],
  );
  const storedCheckIn = checkInState?.row;

  // "Show everything again" is a view-level reset, not a new fact about the day, so it
  // is deliberately not written. A reload restores the stated time — the row is still
  // the truth about what the user said, and re-stating it is one tap.
  const [clearedFor, setClearedFor] = useState<string | null>(null);
  const statedMinutes =
    clearedFor === occurrenceKey ? null : (storedCheckIn?.availableMinutes ?? null);

  // Time already spent in this daypart. Derived from the logs rather than decremented
  // in state: reload-safe, and it cannot drift from what was actually recorded. Only
  // `done` counts — skipping a box must not shrink what is left to pack into the rest
  // of the daypart.
  const spentMinutes = useLiveQuery(
    () =>
      occurrenceDate && selectedDaypart
        ? getSessionLogsForDaypart(occurrenceDate, selectedDaypart.id).then((logs) =>
            logs
              .filter((log) => log.status === "done")
              .reduce((sum, log) => sum + log.minutes, 0),
          )
        : undefined,
    [occurrenceDate, selectedDaypart?.id],
  );

  const remainingMinutes =
    statedMinutes == null ? null : Math.max(statedMinutes - (spentMinutes ?? 0), 0);

  // `null` means no limit stated: every planned session is returned, nothing dropped.
  const reconciled = useLiveQuery(
    () =>
      selectedDaypart
        ? reconcileNow({
            now: initialNow,
            daypartId: selectedDaypart.id,
            availableMinutes: remainingMinutes,
          })
        : undefined,
    [selectedDaypart?.id, remainingMinutes, initialNow],
  );

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [pendingSlotIds, setPendingSlotIds] = useState<ReadonlySet<string>>(new Set());
  const [checkpointTarget, setCheckpointTarget] = useState<CheckpointTarget | null>(null);

  const stateMinutes = async (minutes: number) => {
    if (!selectedDaypart) return;
    const now = localNow();
    const date = daypartDate(selectedDaypart, now);
    await putCheckIn({ daypartId: selectedDaypart.id, availableMinutes: minutes, date }, now);
    setClearedFor(null);
  };

  const promptCheckpointIfDue = async (stage: LocalStage, goalName: string, now: string) => {
    // Gated on exactly what `pace.scopeStatus` needs (D56). Gating on the label
    // alone asked a gym goal "which chapter are you on?" and stored an answer
    // nothing could ever consume — scopeStatus returns all-null without both the
    // unit total and the target date. A goal with no scope is a pure cadence goal
    // and is never asked anything.
    if (!stage.scopeUnitLabel || stage.scopeUnitTotal == null || stage.targetDate == null) {
      return;
    }
    const latest = await getLatestCheckpoint(stage.id);
    if (shouldPromptCheckpoint(now, latest?.loggedAt)) {
      setCheckpointTarget({ stageId: stage.id, goalName, unitLabel: stage.scopeUnitLabel, now });
    }
  };

  // No longer gated on a check-in existing: logging a planned session is the whole
  // point of the screen and must work the moment it renders (D62).
  const logSlot = async (slot: ReconciledSlot, status: "done" | "skipped") => {
    if (!selectedDaypart) return;

    setPendingSlotIds((prev) => new Set(prev).add(slot.slot.id));
    try {
      const now = localNow();
      const date = daypartDate(selectedDaypart, now);
      await logSession(
        {
          stageId: slot.stage.id,
          date,
          daypartId: selectedDaypart.id,
          minutes: slot.slot.minutes,
          status,
          source: "planned",
        },
        now,
      );
      await relayoutWeek({ now });

      if (status === "done") {
        await promptCheckpointIfDue(slot.stage, slot.goal.name, now);
      }
    } finally {
      setPendingSlotIds((prev) => {
        const next = new Set(prev);
        next.delete(slot.slot.id);
        return next;
      });
    }
  };

  // Stages already offered above (in `keep`/`dropped`) shouldn't get a second,
  // redundant logging affordance down in the voluntary section.
  const offeredStageIds = new Set([
    ...(reconciled?.keep.map((r) => r.stage.id) ?? []),
    ...(reconciled?.dropped.map((r) => r.stage.id) ?? []),
  ]);
  const candidates = useLiveQuery(
    () => (occurrenceDate ? voluntaryCandidates(offeredStageIds, occurrenceDate) : undefined),
    [occurrenceDate, reconciled],
  );

  const [pendingVoluntaryIds, setPendingVoluntaryIds] = useState<ReadonlySet<string>>(new Set());

  const logVoluntary = async (stage: LocalStage, goalName: string) => {
    if (!selectedDaypart) return;
    setPendingVoluntaryIds((prev) => new Set(prev).add(stage.id));
    try {
      const now = localNow();
      const date = daypartDate(selectedDaypart, now);
      await logSession(
        {
          stageId: stage.id,
          date,
          daypartId: selectedDaypart.id,
          minutes: stage.sessionMinutes,
          status: "done",
          source: "voluntary",
        },
        now,
      );
      await relayoutWeek({ now });
      await promptCheckpointIfDue(stage, goalName, now);
    } finally {
      setPendingVoluntaryIds((prev) => {
        const next = new Set(prev);
        next.delete(stage.id);
        return next;
      });
    }
  };

  // Held until the stated time has been read too, not just the dayparts — see
  // `checkInState`. One extra indexed lookup, against a list that would otherwise
  // visibly re-pack itself after first paint.
  if (!dataReady || (selectedDaypart != null && checkInState === undefined)) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <DartLoader className="size-16" />
      </div>
    );
  }

  const plannedTotal = requiredMinutes ?? 0;
  const leftInDaypart =
    selectedDaypart && daypartContains(selectedDaypart, initialNow)
      ? minutesRemainingIn(selectedDaypart, initialNow)
      : null;

  return (
    <div className="flex flex-col gap-6 py-6">
      <header className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-display font-semibold text-ink">Today</h1>
          {selectedDaypart && (
            <Button
              variant="ghost"
              size="sm"
              className="text-label h-auto shrink-0 px-2 py-1"
              onClick={() => setAdjustOpen(true)}
            >
              Adjust today
            </Button>
          )}
        </div>

        {selectedDaypart ? (
          <p className="text-label text-text-muted">
            <span className="text-text font-medium">{capitalize(selectedDaypart.name)}</span>
            {" · ends "}
            {formatClockTime(daypartEndsAt(selectedDaypart, initialNow))}
            {daypartOverride != null && " (you changed this)"}
          </p>
        ) : (
          <p className="text-label text-text-muted">No dayparts set up yet.</p>
        )}

        {/* D8's gap, stated and not editorialised. Nothing here is a warning — a
            plan that overruns the daypart is a fact to see, not a failure (D15). */}
        {plannedTotal > 0 && (
          <p className="numeric text-label text-text-muted">
            {statedMinutes != null
              ? `${formatDuration(statedMinutes)} stated · ${formatDuration(remainingMinutes ?? 0)} left`
              : leftInDaypart != null
                ? `${formatDuration(plannedTotal)} planned · ${formatDuration(leftInDaypart)} left`
                : `${formatDuration(plannedTotal)} planned`}
          </p>
        )}
      </header>

      <section className="flex flex-col gap-3">
        {reconciled && reconciled.keep.length === 0 && reconciled.dropped.length === 0 && (
          <p className="text-body text-text-muted">Nothing planned for this daypart.</p>
        )}

        {reconciled?.keep.map((slot) => (
          <SessionCard
            key={slot.slot.id}
            slot={slot}
            pending={pendingSlotIds.has(slot.slot.id)}
            onLog={(status) => logSlot(slot, status)}
          />
        ))}

        {reconciled && reconciled.dropped.length > 0 && (
          <div className="flex flex-col gap-2 pt-2">
            <p className="text-label font-medium text-text-muted">Won&apos;t fit today</p>
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
                  <p className="text-label text-text-muted">{slot.reason}</p>
                </div>
                <span className="numeric text-label text-text-muted">
                  {formatDuration(slot.slot.minutes)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Voluntary catch-up (Architecture.md §9.3, D20): do a session on your own,
          any time, and it credits against the ideal line without ever being owed. */}
      {candidates && candidates.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-title font-semibold text-ink">Log a session</h2>
          <p className="text-label text-text-muted">
            Not on today&apos;s plan, but you did it anyway — it still counts.
          </p>
          <div className="flex flex-col gap-2">
            {candidates.map(({ goal, stage }) => (
              <div
                key={stage.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div>
                  <Link
                    href={`/goals/${goal.id}`}
                    className="text-body text-text underline-offset-4 hover:underline"
                  >
                    {goal.name}
                  </Link>
                  <p className="numeric text-label text-text-muted">
                    {formatDuration(stage.sessionMinutes)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={pendingVoluntaryIds.has(stage.id)}
                  onClick={() => logVoluntary(stage, goal.name)}
                >
                  Done
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeGoals.length > 0 && (
        <section className="flex flex-col">
          <h2 className="pb-1 text-title font-semibold text-ink">On track</h2>
          {activeGoals
            .filter((g) => g.stage != null)
            .map(({ goal, stage }) => (
              <GoalStatusRow key={goal.id} goal={goal} stage={stage!} now={initialNow} />
            ))}
        </section>
      )}

      {/* Keyed so the panel's minutes field starts from whatever is currently stated.
          It seeds that from a prop in `useState`, which runs once per mount — without
          a key it would keep showing the value from the first render forever. */}
      <AdjustToday
        key={`${occurrenceKey}|${statedMinutes ?? ""}`}
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        dayparts={dayparts}
        selectedDaypart={selectedDaypart}
        onSelectDaypart={setDaypartOverride}
        daypartWasChanged={daypartOverride != null}
        requiredMinutes={plannedTotal}
        statedMinutes={statedMinutes}
        onStateMinutes={stateMinutes}
        onClearStatedMinutes={() => setClearedFor(occurrenceKey)}
        now={initialNow}
      />

      <CheckpointPrompt target={checkpointTarget} onDone={() => setCheckpointTarget(null)} />
    </div>
  );
}
