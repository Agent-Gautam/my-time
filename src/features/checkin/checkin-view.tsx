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

import { currentDaypart, localNow } from "@/lib/daypart";
import { getDayparts, getGoalsWithStage } from "@/db/local/queries";

import { CheckpointPrompt, type CheckpointTarget } from "./checkpoint-prompt";
import { DaypartPanel } from "./daypart-panel";
import { GoalStatusRow } from "./goal-status-row";
import { TasksSection } from "./tasks-section";

export function CheckinView() {
  const [initialNow] = useState(() => localNow());
  const dayparts = useLiveQuery(() => getDayparts(), [], []);
  const activeGoals = useLiveQuery(() => getGoalsWithStage({ states: ["active"] }), [], []);

  const dataReady = useLiveQuery(() => getDayparts().then(() => true), [], false);

  const detectedDaypartId = currentDaypart(dayparts, initialNow)?.id ?? dayparts[0]?.id ?? null;
  const [daypartOverride, setDaypartOverride] = useState<string | null>(null);
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

  return (
    <div className="flex flex-col gap-6 py-6">
      <header>
        <h1 className="text-display font-semibold text-ink">Today</h1>
      </header>

      {dayparts.length === 0 ? (
        <p className="text-label text-text-muted">No dayparts set up yet.</p>
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
