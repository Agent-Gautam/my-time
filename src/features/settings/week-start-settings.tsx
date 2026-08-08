"use client";

// Week start day — configurable first day of the rolling plan window.
// Stored in the device-local `settings` table (never synced).
// Changing it triggers a relayout so the new window takes effect immediately.

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getWeekStartDay, setWeekStartDay } from "@/db/local/queries";
import { relayoutWeek } from "@/features/plan/planner";
import { localNow } from "@/lib/daypart";
import type { Weekday } from "@/core/types";

const WEEKDAY_LABELS: { value: Weekday; label: string }[] = [
  { value: "mon", label: "Monday" },
  { value: "tue", label: "Tuesday" },
  { value: "wed", label: "Wednesday" },
  { value: "thu", label: "Thursday" },
  { value: "fri", label: "Friday" },
  { value: "sat", label: "Saturday" },
  { value: "sun", label: "Sunday" },
];

export function WeekStartSettings() {
  const currentDay = useLiveQuery(() => getWeekStartDay(), []);
  const [saving, setSaving] = useState(false);

  async function handleChange(value: Weekday | null) {
    if (!value) return;
    setSaving(true);
    try {
      await setWeekStartDay(value);
      const now = localNow();
      await relayoutWeek({ now });
      toast.success("Week start updated.");
    } finally {
      setSaving(false);
    }
  }

  if (currentDay === undefined) return null;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="week-start-day">Week starts on</Label>
      <Select
        value={currentDay}
        onValueChange={handleChange}
        disabled={saving}
      >
        <SelectTrigger id="week-start-day" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WEEKDAY_LABELS.map(({ value, label }) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
