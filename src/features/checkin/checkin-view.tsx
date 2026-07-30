"use client";

// The daily loop (PRD §6.5–§6.7, Architecture.md §9.2):
//   detect/confirm daypart -> surface the three numbers (D8) -> state available
//   minutes -> reconcileNow packs the fitting sessions -> one tap per session logs
//   it -> relayoutWeek regenerates future slots -> the on-track summary, calmly.
//
// **Clock reads (D53's convention, applied at every write site here):** the
// mount-time `initialNow` below is a read-only convenience — it seeds the
// detected-daypart default and the pre-check-in stat numbers, both of which the
// user reviews and can correct before anything is written (PRD §6.5: "confirms or
// corrects"). Every actual write — `putCheckIn`, `logSession`, `putCheckpoint` —
// calls `localNow()` fresh at the moment of that action instead of reusing a
// frozen value, so a tab left open and backgrounded for hours (the normal PWA
// resume pattern) can't record a session against the wrong daypart or the wrong
// calendar day.
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  currentDaypart,
  daypartContains,
  daypartDate,
  daypartEndsAt,
  daypartLengthMinutes,
  localNow,
  minutesRemainingIn,
} from "@/lib/daypart";
import { getDayparts, getGoalsWithStage, getLatestCheckpoint } from "@/db/local/queries";
import { logSession, putCheckIn } from "@/db/local/mutations";
import type { LocalStage } from "@/db/local/schema";
import type { IsoDate, IsoDateTime } from "@/core/types";
import { reconcileNow, relayoutWeek, type ReconciledSlot } from "@/features/plan/planner";

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

interface ActiveCheckIn {
  now: IsoDateTime;
  daypartId: string;
  today: IsoDate;
}

export function CheckinView() {
  const [initialNow] = useState(() => localNow());
  const dayparts = useLiveQuery(() => getDayparts(), [], []);
  const activeGoals = useLiveQuery(() => getGoalsWithStage({ states: ["active"] }), [], []);

  // Detected daypart is a derived value, not stored state — an override only
  // exists once the user actually corrects it (PRD §6.5: "confirms or corrects").
  const detectedDaypartId = currentDaypart(dayparts, initialNow)?.id ?? dayparts[0]?.id ?? null;
  const [daypartOverride, setDaypartOverride] = useState<string | null>(null);
  const selectedDaypartId = daypartOverride ?? detectedDaypartId;
  const selectedDaypart = dayparts.find((dp) => dp.id === selectedDaypartId) ?? null;

  const requiredMinutes = useLiveQuery(
    () =>
      selectedDaypart
        ? requiredMinutesForDaypart(daypartDate(selectedDaypart, initialNow), selectedDaypart.id)
        : undefined,
    [selectedDaypart, initialNow],
  );

  const [availableMinutesInput, setAvailableMinutesInput] = useState("");
  const [activeCheckIn, setActiveCheckIn] = useState<ActiveCheckIn | null>(null);
  const [remainingMinutes, setRemainingMinutes] = useState(0);
  const [pendingSlotIds, setPendingSlotIds] = useState<ReadonlySet<string>>(new Set());
  const [checkpointTarget, setCheckpointTarget] = useState<CheckpointTarget | null>(null);

  const reconciled = useLiveQuery(
    () =>
      activeCheckIn
        ? reconcileNow({
            now: activeCheckIn.now,
            daypartId: activeCheckIn.daypartId,
            availableMinutes: remainingMinutes,
          })
        : undefined,
    [activeCheckIn, remainingMinutes],
  );

  const submitCheckIn = async () => {
    if (!selectedDaypart) return;
    const minutes = Number(availableMinutesInput);
    if (!Number.isFinite(minutes) || minutes < 0) return;

    const now = localNow();
    const today = daypartDate(selectedDaypart, now);
    await putCheckIn({ daypartId: selectedDaypart.id, availableMinutes: minutes, date: today }, now);
    setRemainingMinutes(minutes);
    setActiveCheckIn({ now, daypartId: selectedDaypart.id, today });
  };

  const promptCheckpointIfDue = async (stage: LocalStage, goalName: string, now: string) => {
    if (!stage.scopeUnitLabel) return;
    const latest = await getLatestCheckpoint(stage.id);
    if (shouldPromptCheckpoint(now, latest?.loggedAt)) {
      setCheckpointTarget({ stageId: stage.id, goalName, unitLabel: stage.scopeUnitLabel, now });
    }
  };

  const logSlot = async (slot: ReconciledSlot, status: "done" | "skipped") => {
    if (!activeCheckIn) return;

    setPendingSlotIds((prev) => new Set(prev).add(slot.slot.id));
    try {
      await logSession(
        {
          stageId: slot.stage.id,
          date: activeCheckIn.today,
          daypartId: activeCheckIn.daypartId,
          minutes: slot.slot.minutes,
          status,
          source: "planned",
        },
        activeCheckIn.now,
      );
      await relayoutWeek({ now: activeCheckIn.now });

      // Only a completed session eats into the time actually spent — skipping a
      // box shouldn't shrink what's left to pack into the rest of the daypart.
      if (status === "done") {
        setRemainingMinutes((prev) => Math.max(prev - slot.slot.minutes, 0));
        await promptCheckpointIfDue(slot.stage, slot.goal.name, activeCheckIn.now);
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
  const voluntaryToday = selectedDaypart ? daypartDate(selectedDaypart, initialNow) : null;
  const candidates = useLiveQuery(
    () => (voluntaryToday ? voluntaryCandidates(offeredStageIds, voluntaryToday) : undefined),
    [voluntaryToday, reconciled],
  );

  const [pendingVoluntaryIds, setPendingVoluntaryIds] = useState<ReadonlySet<string>>(new Set());

  const logVoluntary = async (stage: LocalStage, goalName: string) => {
    if (!selectedDaypart) return;
    setPendingVoluntaryIds((prev) => new Set(prev).add(stage.id));
    try {
      const now = localNow();
      const today = daypartDate(selectedDaypart, now);
      await logSession(
        {
          stageId: stage.id,
          date: today,
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

  const daypartOptions = dayparts.map((dp) => ({ id: dp.id, label: capitalize(dp.name) }));

  return (
    <div className="flex flex-col gap-6 py-6">
      <h1 className="text-display font-semibold text-ink">Today</h1>

      {!activeCheckIn || !reconciled ? (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="checkin-daypart">Daypart</Label>
              <Select
                value={selectedDaypartId ?? undefined}
                onValueChange={(value) => setDaypartOverride(value as string)}
              >
                <SelectTrigger id="checkin-daypart" className="w-full">
                  <SelectValue placeholder="Pick a daypart" />
                </SelectTrigger>
                <SelectContent>
                  {daypartOptions.map((dp) => (
                    <SelectItem key={dp.id} value={dp.id}>
                      {dp.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedDaypart && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-2 p-3 sm:grid-cols-4">
                <Stat label="Required" value={`${requiredMinutes ?? 0}m`} />
                <Stat label="Length" value={`${daypartLengthMinutes(selectedDaypart)}m`} />
                {/* minutesRemainingIn is 0 whenever `now` isn't actually inside the
                    daypart — the normal case right after the user picks a daypart
                    other than the detected one. "—" reads as "not applicable yet";
                    "0m" would read as broken. */}
                <Stat
                  label="Remaining"
                  value={
                    daypartContains(selectedDaypart, initialNow)
                      ? `${minutesRemainingIn(selectedDaypart, initialNow)}m`
                      : "—"
                  }
                />
                <Stat label="Ends at" value={formatClockTime(daypartEndsAt(selectedDaypart, initialNow))} />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="checkin-minutes">Minutes you have now</Label>
              <Input
                id="checkin-minutes"
                type="number"
                inputMode="numeric"
                min={0}
                value={availableMinutesInput}
                onChange={(e) => setAvailableMinutesInput(e.target.value)}
              />
            </div>

            <Button
              className="min-h-11"
              disabled={!selectedDaypart || availableMinutesInput === ""}
              onClick={submitCheckIn}
            >
              Check in
            </Button>
          </CardContent>
        </Card>
      ) : (
        <section className="flex flex-col gap-3">
          {reconciled.keep.length === 0 && reconciled.dropped.length === 0 && (
            <p className="text-body text-text-muted">Nothing planned for this daypart.</p>
          )}

          {reconciled.keep.map((slot) => (
            <SessionCard
              key={slot.slot.id}
              slot={slot}
              pending={pendingSlotIds.has(slot.slot.id)}
              onLog={(status) => logSlot(slot, status)}
            />
          ))}

          {reconciled.dropped.length > 0 && (
            <div className="flex flex-col gap-2 pt-2">
              <p className="text-label font-medium text-text-muted">Won&apos;t fit today</p>
              {reconciled.dropped.map((slot) => (
                <div
                  key={slot.slot.id}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                >
                  <div>
                    <p className="text-body text-text">{slot.goal.name}</p>
                    <p className="text-label text-text-muted">{slot.reason}</p>
                  </div>
                  <span className="numeric text-label text-text-muted">{slot.slot.minutes}m</span>
                </div>
              ))}
            </div>
          )}

          <Button
            variant="ghost"
            className="min-h-11 self-start"
            onClick={() => setActiveCheckIn(null)}
          >
            Re-check in
          </Button>
        </section>
      )}

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
                  <p className="text-body text-text">{goal.name}</p>
                  <p className="numeric text-label text-text-muted">{stage.sessionMinutes}m</p>
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

      <CheckpointPrompt target={checkpointTarget} onDone={() => setCheckpointTarget(null)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption text-text-subtle">{label}</span>
      <span className="numeric text-section font-semibold text-ink">{value}</span>
    </div>
  );
}
