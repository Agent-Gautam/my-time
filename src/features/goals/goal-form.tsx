"use client";

// Create/edit a goal and its one implicit stage (PRD §6.3) — protocol fields live
// on the stage, and `putGoalWithStage` saves both in one transaction so there is
// never a goal the scheduler can't see. No blank form (O3): every field below
// starts from a sensible default except name/purpose, which are what the user is
// actually here to say.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NumberField } from "@/components/number-field";
import { DurationField } from "@/components/duration-field";

import { getDayparts } from "@/db/local/queries";
import { newId, putGoalWithStage, dropGoal } from "@/db/local/mutations";
import { localNow } from "@/lib/daypart";
import { relayoutWeek } from "@/features/plan/planner";
import type { CadenceType, GoalState, Weekday } from "@/core/types";
import type { LocalGoal, LocalStage } from "@/db/local/schema";

const TIER_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Critical" },
  { value: 2, label: "Normal" },
  { value: 3, label: "Background" },
];

const WEEKDAY_OPTIONS: { value: Weekday; label: string }[] = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

export interface GoalFormProps {
  /** Existing goal + stage when editing; omitted for create. */
  existing?: { goal: LocalGoal; stage: LocalStage };
}

export function GoalForm({ existing }: GoalFormProps) {
  const router = useRouter();
  const dayparts = useLiveQuery(() => getDayparts(), []);

  const [name, setName] = useState(existing?.goal.name ?? "");
  const [purpose, setPurpose] = useState(existing?.goal.purpose ?? "");
  const [tier, setTier] = useState(existing?.goal.tier ?? 2);
  const [state, setState] = useState<GoalState>(existing?.goal.state ?? "active");

  const [sessionMinutes, setSessionMinutes] = useState(
    existing?.stage.sessionMinutes ?? 30,
  );
  const [cadenceType, setCadenceType] = useState<CadenceType>(
    existing?.stage.cadenceType ?? "frequency",
  );
  const [cadenceCount, setCadenceCount] = useState(
    existing?.stage.cadenceCount ?? 3,
  );
  const [cadenceDays, setCadenceDays] = useState<Weekday[]>(
    existing?.stage.cadenceDays ?? [],
  );
  // `null` means "not yet touched" — the create form defaults to every daypart
  // once they load (O3: never present an empty checkbox set), without needing an
  // effect to seed it.
  const [eligibleDaypartsTouched, setEligibleDaypartsTouched] = useState<
    string[] | null
  >(existing?.stage.eligibleDayparts ?? null);
  const eligibleDayparts =
    eligibleDaypartsTouched ?? (dayparts ?? []).map((d) => d.id);

  const [maxPerWeek, setMaxPerWeek] = useState(
    existing?.stage.maxPerWeek != null ? String(existing.stage.maxPerWeek) : "",
  );
  const [minRestDays, setMinRestDays] = useState(
    existing?.stage.minRestDays != null ? String(existing.stage.minRestDays) : "",
  );
  const [scopeUnitLabel, setScopeUnitLabel] = useState(
    existing?.stage.scopeUnitLabel ?? "",
  );
  const [scopeUnitTotal, setScopeUnitTotal] = useState(
    existing?.stage.scopeUnitTotal != null ? String(existing.stage.scopeUnitTotal) : "",
  );
  const [targetDate, setTargetDate] = useState(existing?.stage.targetDate ?? "");

  const [saving, setSaving] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDaypart(id: string) {
    setEligibleDaypartsTouched(
      eligibleDayparts.includes(id)
        ? eligibleDayparts.filter((d) => d !== id)
        : [...eligibleDayparts, id],
    );
  }

  function toggleDay(day: Weekday) {
    setCadenceDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  // What the stage actually asks for in a week. `handleSubmit` derives the stored
  // `cadenceCount` the same way for fixed days, so the two can't drift apart.
  const weeklyCadence = cadenceType === "fixed_days" ? cadenceDays.length : cadenceCount;

  function validate(): string | null {
    if (name.trim().length === 0) return "Name is required.";
    if (eligibleDayparts.length === 0) return "Pick at least one daypart.";
    if (sessionMinutes < 1) return "Session length must be at least 1 minute.";
    if (cadenceType === "frequency" && cadenceCount < 1) {
      return "Cadence must be at least once a week.";
    }
    if (cadenceType === "fixed_days" && cadenceDays.length === 0) {
      return "Pick at least one fixed day.";
    }
    if (cadenceType === "hybrid") {
      if (cadenceCount < 1) return "Cadence must be at least once a week.";
      if (cadenceDays.length === 0) return "Pick at least one required day.";
      if (cadenceDays.length > cadenceCount) {
        return "Required days can't outnumber the weekly cadence.";
      }
    }
    // D64. A weekly max below the cadence is the user contradicting themselves, and it
    // used to be resolved silently in two opposite directions at once: layout cut the
    // plan down to the max, while the check-in screen called the week unreachable.
    // Refused here instead — the only place the two numbers are visible together.
    if (maxPerWeek.trim() !== "") {
      const max = Number(maxPerWeek);
      if (!Number.isFinite(max) || max < 1) return "Weekly max must be at least 1.";
      if (max < weeklyCadence) {
        return `Weekly max can't be below the ${weeklyCadence}×/week cadence — it's a ceiling on catch-up, not a second cadence.`;
      }
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const now = localNow();
      const goalId = existing?.goal.id ?? newId();
      const stageId = existing?.stage.id ?? newId();

      await putGoalWithStage(
        { id: goalId, name: name.trim(), purpose: purpose.trim(), tier, state },
        {
          id: stageId,
          goalId,
          sessionMinutes,
          cadenceType,
          cadenceCount: cadenceType === "fixed_days" ? cadenceDays.length : cadenceCount,
          cadenceDays: cadenceType === "frequency" ? null : cadenceDays,
          eligibleDayparts,
          maxPerWeek: maxPerWeek.trim() === "" ? null : Math.max(0, Number(maxPerWeek)),
          minRestDays: minRestDays.trim() === "" ? null : Math.max(0, Number(minRestDays)),
          scopeUnitLabel: scopeUnitLabel.trim() === "" ? null : scopeUnitLabel.trim(),
          scopeUnitTotal:
            scopeUnitTotal.trim() === "" ? null : Math.max(0, Number(scopeUnitTotal)),
          targetDate: targetDate === "" ? null : targetDate,
          deadlineDerived: false,
          sortOrder: existing?.stage.sortOrder ?? 0,
          state: existing?.stage.state ?? "active",
        },
        now,
      );
      await relayoutWeek({ now });
      toast.success(existing ? "Goal updated." : "Goal created.");
      router.push("/goals");
    } finally {
      setSaving(false);
    }
  }

  async function handleDrop() {
    if (!existing) return;
    const now = localNow();
    await dropGoal(existing.goal.id, now);
    await relayoutWeek({ now });
    toast.success("Goal dropped.");
    router.push("/goals");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 pb-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal-name">Name</Label>
          <Input
            id="goal-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. GATE prep"
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal-purpose">Purpose</Label>
          <Textarea
            id="goal-purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Why this goal matters"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Priority tier</Label>
          <RadioGroup
            value={String(tier)}
            onValueChange={(v) => setTier(Number(v))}
            className="flex flex-row gap-4"
          >
            {TIER_OPTIONS.map((opt) => (
              <div key={opt.value} className="flex items-center gap-2">
                <RadioGroupItem value={String(opt.value)} id={`tier-${opt.value}`} />
                <Label htmlFor={`tier-${opt.value}`}>{opt.label}</Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {existing ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-state">State</Label>
            <Select value={state} onValueChange={(v) => setState(v as GoalState)}>
              <SelectTrigger id="goal-state" className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="planned">Planned</SelectItem>
                <SelectItem value="active">Active</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 border-t border-border pt-6">
        <h2 className="text-section font-semibold text-text">Protocol</h2>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal-session-hours">Session length</Label>
          <DurationField
            idPrefix="goal-session"
            value={sessionMinutes}
            onChange={setSessionMinutes}
            min={1}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>How often</Label>
          <RadioGroup
            value={cadenceType}
            onValueChange={(v) => setCadenceType(v as CadenceType)}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="frequency" id="cadence-frequency" />
              <Label htmlFor="cadence-frequency">Frequency — any days</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="fixed_days" id="cadence-fixed" />
              <Label htmlFor="cadence-fixed">Fixed days</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="hybrid" id="cadence-hybrid" />
              <Label htmlFor="cadence-hybrid">Hybrid — count plus required days</Label>
            </div>
          </RadioGroup>
        </div>

        {cadenceType !== "fixed_days" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-cadence-count">Sessions per week</Label>
            <NumberField
              id="goal-cadence-count"
              min={1}
              className="w-24"
              value={cadenceCount}
              onChange={setCadenceCount}
            />
          </div>
        ) : null}

        {cadenceType !== "frequency" ? (
          <div className="flex flex-col gap-1.5">
            <Label>
              {cadenceType === "fixed_days" ? "Days" : "Required days"}
            </Label>
            <div className="flex flex-wrap gap-3">
              {WEEKDAY_OPTIONS.map((day) => (
                <div key={day.value} className="flex items-center gap-1.5">
                  <Checkbox
                    id={`day-${day.value}`}
                    checked={cadenceDays.includes(day.value)}
                    onCheckedChange={() => toggleDay(day.value)}
                  />
                  <Label htmlFor={`day-${day.value}`}>{day.label}</Label>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label>Eligible dayparts</Label>
          <div className="flex flex-wrap gap-3">
            {(dayparts ?? []).map((daypart) => (
              <Tooltip key={daypart.id}>
                <TooltipTrigger
                  render={
                    <div className="flex items-center gap-1.5">
                      <Checkbox
                        id={`daypart-${daypart.id}`}
                        checked={eligibleDayparts.includes(daypart.id)}
                        onCheckedChange={() => toggleDaypart(daypart.id)}
                      />
                      <Label htmlFor={`daypart-${daypart.id}`} className="capitalize">
                        {daypart.name}
                      </Label>
                    </div>
                  }
                />
                <TooltipContent>
                  {daypart.startTime}–{daypart.endTime}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-label font-semibold text-text">Recovery (optional)</h3>
            <p className="text-label text-text-subtle">
              Ceilings for catch-up, not a second cadence. The plan always schedules
              the cadence above; these limit only what you add on top of it, so a
              missed session can&apos;t turn into a six-day training week. Weekly max
              counts the whole week together — scheduled and caught-up.
            </p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="goal-max-per-week">Weekly max</Label>
              <Input
                id="goal-max-per-week"
                type="number"
                min={weeklyCadence}
                value={maxPerWeek}
                onChange={(e) => setMaxPerWeek(e.target.value)}
                placeholder="No hard ceiling"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="goal-min-rest">Min rest days</Label>
              <Input
                id="goal-min-rest"
                type="number"
                min={0}
                value={minRestDays}
                onChange={(e) => setMinRestDays(e.target.value)}
                placeholder="No minimum gap"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t border-border pt-6">
        <div>
          <h2 className="text-section font-semibold text-text">
            Scope (optional)
          </h2>
          <p className="text-label text-text-subtle">
            For goals with a countable amount of work — chapters to read, kg to
            gain, lessons to finish. Set a unit and a total, and the app tracks
            progress toward it alongside your cadence. Leave blank for a
            cadence-only goal with no fixed endpoint.
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="goal-scope-label">Unit label</Label>
            <Input
              id="goal-scope-label"
              value={scopeUnitLabel}
              onChange={(e) => setScopeUnitLabel(e.target.value)}
              placeholder="e.g. chapter"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="goal-scope-total">Total units</Label>
            <Input
              id="goal-scope-total"
              type="number"
              min={0}
              value={scopeUnitTotal}
              onChange={(e) => setScopeUnitTotal(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal-target-date">Target date</Label>
          <Input
            id="goal-target-date"
            type="date"
            className="w-48"
            value={targetDate ?? ""}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </div>
      </div>

      {error ? <p className="text-body text-blocked">{error}</p> : null}

      <div className="flex items-center justify-between gap-3 border-t border-border pt-6">
        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : existing ? "Save changes" : "Create goal"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/goals")}
          >
            Cancel
          </Button>
        </div>

        {existing ? (
          <Dialog open={dropOpen} onOpenChange={setDropOpen}>
            <DialogTrigger
              render={
                <Button type="button" variant="destructive">
                  Drop goal
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Drop this goal?</DialogTitle>
                <DialogDescription>
                  It stays in history and stops being scheduled. You can start a
                  new cycle any time.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter showCloseButton>
                <Button variant="destructive" onClick={handleDrop}>
                  Drop
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </form>
  );
}
