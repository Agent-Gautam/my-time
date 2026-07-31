"use client";

// "Adjust today" — the explicit, occasional act of telling the app how much time you
// actually have (D62).
//
// This is what used to be the check-in form, and it shows exactly what that form
// showed: the detected daypart with a correction, D8's four numbers, and the minutes
// field. What changed is that it is no longer a gate — Today renders the plan without
// it, and this panel only exists for the days that are not ordinary.
//
// **The stored concept is still a check-in.** `putCheckIn` writes a `checkIns` row and
// the sync table keeps its name; only the words on screen changed. Renaming the record
// would reshape the schema, the frozen `core/types.ts` and the sync protocol at once,
// which D51 forbids, and the fact being stored is unchanged: the user said they had N
// minutes for this daypart at time T.

import { useState } from "react";

import { Button } from "@/components/ui/button";
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
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import {
  daypartContains,
  daypartEndsAt,
  daypartLengthMinutes,
  minutesRemainingIn,
} from "@/lib/daypart";
import { formatDuration } from "@/lib/duration";
import type { LocalDaypart } from "@/db/local/schema";
import type { IsoDateTime } from "@/core/types";

import { capitalize, formatClockTime } from "./lib";

interface AdjustTodayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dayparts: LocalDaypart[];
  selectedDaypart: LocalDaypart | null;
  onSelectDaypart: (daypartId: string) => void;
  daypartWasChanged: boolean;
  /** Total minutes the plan wants in this daypart (D8). */
  requiredMinutes: number;
  /** Minutes already stated for this daypart occurrence, or null if never stated. */
  statedMinutes: number | null;
  onStateMinutes: (minutes: number) => Promise<void> | void;
  onClearStatedMinutes: () => Promise<void> | void;
  /** Read-only, reviewed by the user before anything is written (PRD §6.5). */
  now: IsoDateTime;
}

export function AdjustToday({
  open,
  onOpenChange,
  dayparts,
  selectedDaypart,
  onSelectDaypart,
  daypartWasChanged,
  requiredMinutes,
  statedMinutes,
  onStateMinutes,
  onClearStatedMinutes,
  now,
}: AdjustTodayProps) {
  const [minutesInput, setMinutesInput] = useState(
    statedMinutes == null ? "" : String(statedMinutes),
  );
  const [showDaypartPicker, setShowDaypartPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const minutes = Number(minutesInput);
    if (!Number.isFinite(minutes) || minutes < 0) return;
    setSaving(true);
    try {
      await onStateMinutes(minutes);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await onClearStatedMinutes();
      setMinutesInput("");
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Adjust today</SheetTitle>
          <SheetDescription>
            Tell the app how much time you actually have, and the list is packed to
            fit.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-2">
          {/* The app knows the time, so it states the daypart rather than asking for
              it. PRD §6.5 is "confirms or corrects", and a required <Select> made
              every visit a correction. */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-label text-text-muted">
                {selectedDaypart ? (
                  <>
                    It&rsquo;s{" "}
                    <span className="text-text font-medium">
                      {capitalize(selectedDaypart.name)}
                    </span>
                    {!showDaypartPicker && daypartWasChanged && " (you changed this)"}
                  </>
                ) : (
                  "No dayparts set up yet."
                )}
              </p>
              {!showDaypartPicker && dayparts.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-label h-auto shrink-0 px-2 py-1"
                  onClick={() => setShowDaypartPicker(true)}
                >
                  Change
                </Button>
              )}
            </div>

            {showDaypartPicker && (
              <>
                <Label htmlFor="adjust-daypart" className="sr-only">
                  Daypart
                </Label>
                <Select
                  value={selectedDaypart?.id ?? undefined}
                  onValueChange={(value) => {
                    onSelectDaypart(value as string);
                    setShowDaypartPicker(false);
                  }}
                >
                  <SelectTrigger id="adjust-daypart" className="w-full">
                    <SelectValue placeholder="Pick a daypart" />
                  </SelectTrigger>
                  <SelectContent>
                    {dayparts.map((dp) => (
                      <SelectItem key={dp.id} value={dp.id}>
                        {capitalize(dp.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>

          {selectedDaypart && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-2 p-3 sm:grid-cols-4">
              <Stat label="Required" value={formatDuration(requiredMinutes)} />
              <Stat
                label="Length"
                value={formatDuration(daypartLengthMinutes(selectedDaypart))}
              />
              {/* minutesRemainingIn is 0 whenever `now` isn't actually inside the
                  daypart — the normal case right after picking one other than the
                  detected one. "—" reads as "not applicable yet"; "0m" reads as
                  broken. */}
              <Stat
                label="Remaining"
                value={
                  daypartContains(selectedDaypart, now)
                    ? formatDuration(minutesRemainingIn(selectedDaypart, now))
                    : "—"
                }
              />
              <Stat
                label="Ends at"
                value={formatClockTime(daypartEndsAt(selectedDaypart, now))}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="adjust-minutes">Minutes you have now</Label>
            <Input
              id="adjust-minutes"
              type="number"
              inputMode="numeric"
              min={0}
              value={minutesInput}
              onChange={(e) => setMinutesInput(e.target.value)}
            />
          </div>
        </div>

        <SheetFooter>
          <Button
            className="min-h-11"
            disabled={!selectedDaypart || minutesInput === "" || saving}
            onClick={submit}
          >
            Pack the list
          </Button>
          {statedMinutes != null && (
            <Button
              variant="ghost"
              className="min-h-11"
              disabled={saving}
              onClick={clear}
            >
              Show everything again
            </Button>
          )}
          <SheetClose
            render={
              <Button variant="outline" className="min-h-11">
                Cancel
              </Button>
            }
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
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
