"use client";

// Today (PRD §6.5–§6.7, Architecture.md §9.2, D71) — a single-daypart carousel.
// Exactly one daypart's card renders at a time; its header carries prev/next arrows
// that move which daypart is being *viewed*. The resting view is always the current
// daypart. Browsing away from it doesn't change what's current — it just shows a
// dimmed "past"/"future" card (tint alone, no text, same as before) until the user
// arrows back or taps "Set current."
//
// **This component is the orchestrator only.** Everything per-daypart — occurrence
// date, stated time, reconciliation, logging, the old `AdjustToday` sheet's content —
// lives in `<DaypartPanel>` now, parametrized by whichever daypart is being viewed.
// `session-card.tsx` and `task-list.tsx` were already generic per-daypart components
// and needed no changes.
//
// **Opening Today costs nothing (D63).** The viewed panel renders its own plan
// immediately; nothing gates behind a form.
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { DartLoader } from "@/components/dart-mark";

import {
  currentDaypart,
  localNow,
  minutesSinceMidnight,
  minutesOfDay,
} from "@/lib/daypart";
import { getDayparts, getGoalsWithStage } from "@/db/local/queries";
import type { LocalDaypart } from "@/db/local/schema";

import { CheckpointPrompt, type CheckpointTarget } from "./checkpoint-prompt";
import { DaypartPanel } from "./daypart-panel";
import { FreeTimeCard } from "./free-time-card";
import { GoalStatusRow } from "./goal-status-row";
import { TasksSection } from "./tasks-section";

/** Returns the next daypart whose start time is strictly after `nowMinute`, wrapping. */
function nextDaypartAfter(
  dayparts: readonly LocalDaypart[],
  nowMinute: number,
): LocalDaypart | null {
  if (dayparts.length === 0) return null;
  // Find the first daypart that starts after now (today or wrapping to tomorrow).
  const sorted = [...dayparts].sort(
    (a, b) => minutesOfDay(a.startTime) - minutesOfDay(b.startTime),
  );
  // Prefer one that starts later today.
  const later = sorted.find((dp) => minutesOfDay(dp.startTime) > nowMinute);
  // Otherwise the next one wraps to tomorrow — pick the earliest-starting.
  return later ?? sorted[0] ?? null;
}

export function CheckinView() {
  const [initialNow] = useState(() => localNow());
  const dayparts = useLiveQuery(() => getDayparts(), [], []);
  const activeGoals = useLiveQuery(() => getGoalsWithStage({ states: ["active"] }), [], []);

  const dataReady = useLiveQuery(() => getDayparts().then(() => true), [], false);

  // Whether the wall clock is currently between dayparts (a gap the user configured).
  const activeDaypart = dataReady ? currentDaypart(dayparts, initialNow) : undefined;
  const isFreeTime = dataReady && dayparts.length > 0 && activeDaypart === null;

  const detectedDaypartId = activeDaypart?.id ?? dayparts[0]?.id ?? null;
  const [daypartOverride, setDaypartOverride] = useState<string | null>(null);
  // Recompute from live dayparts on every render — dayparts may not be loaded on
  // the first render, so we cannot freeze this into state. `detectedDaypartId` is
  // derived from `dayparts` (a live query result) and `initialNow` (stable), so it
  // re-resolves to the correct daypart once the live query populates.
  const currentDaypartId = daypartOverride ?? detectedDaypartId;

  // `null` means "follow the current daypart" — the resting state. Arrows set this
  // explicitly to whichever neighbor the user browses to; it stays sticky until
  // cleared by "Set current".
  const [viewedId, setViewedId] = useState<string | null>(null);
  const viewedDaypartId = viewedId ?? currentDaypartId;

  const [checkpointTarget, setCheckpointTarget] = useState<CheckpointTarget | null>(null);

  if (!dataReady) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <DartLoader className="size-16" />
      </div>
    );
  }

  const currentIndex = dayparts.findIndex((dp) => dp.id === currentDaypartId);
  const viewedIndex = dayparts.findIndex((dp) => dp.id === viewedDaypartId);
  const viewedDaypart = dayparts[viewedIndex] ?? null;

  const stepViewed = (delta: 1 | -1) => {
    if (dayparts.length === 0 || viewedIndex === -1) return;
    const next = dayparts[(viewedIndex + delta + dayparts.length) % dayparts.length];
    setViewedId(next.id);
  };

  // When free-time and the user hasn't manually navigated to a daypart,
  // show the free-time card. If they arrow to browse, show that panel.
  const showFreeTime = isFreeTime && viewedId === null && daypartOverride === null;
  const nowMinute = minutesSinceMidnight(initialNow);
  const nextDaypart = showFreeTime ? nextDaypartAfter(dayparts, nowMinute) : null;

  return (
    <div className="flex flex-col gap-6 py-6">
      <header>
        <h1 className="text-display font-semibold text-ink">Today</h1>
      </header>

      {dayparts.length === 0 ? (
        <p className="text-label text-text-muted">No dayparts set up yet.</p>
      ) : showFreeTime ? (
        <FreeTimeCard
          nextDaypart={nextDaypart}
          onBrowse={() => setViewedId(dayparts[0]?.id ?? null)}
        />
      ) : (
        viewedDaypart && (
          <DaypartPanel
            key={viewedDaypart.id}
            daypart={viewedDaypart}
            now={initialNow}
            position={
              viewedIndex === currentIndex
                ? "current"
                : viewedIndex < currentIndex
                  ? "past"
                  : "future"
            }
            daypartWasChanged={viewedDaypart.id === currentDaypartId && daypartOverride != null}
            onSetCurrent={() => {
              setDaypartOverride(viewedDaypart.id);
              setViewedId(null);
            }}
            onCheckpointDue={setCheckpointTarget}
            onPrev={() => stepViewed(-1)}
            onNext={() => stepViewed(1)}
          />
        )
      )}

      {dayparts.length > 0 && <TasksSection dayparts={dayparts} now={initialNow} />}

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

      <CheckpointPrompt target={checkpointTarget} onDone={() => setCheckpointTarget(null)} />
    </div>
  );
}
