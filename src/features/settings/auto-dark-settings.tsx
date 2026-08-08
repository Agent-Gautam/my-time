"use client";

// Auto dark theme — user-configurable start time.
//
// When the user picks a time here, `auto` mode switches to dark at that time
// (and back to light at 06:00). Clearing it restores the legacy behaviour:
// dark during the "night" daypart, if one exists.

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAutoDarkStart, setAutoDarkStart } from "@/db/local/queries";

export function AutoDarkSettings() {
  const stored = useLiveQuery(() => getAutoDarkStart(), []);
  // `undefined` = loading, `null` = unset, `"HH:mm"` = set
  const [localValue, setLocalValue] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // Controlled value: prefer local edits over the stored value so typing isn't jumpy.
  const displayValue = localValue ?? stored ?? "";

  async function handleSave() {
    const trimmed = (localValue ?? "").trim();
    setSaving(true);
    try {
      await setAutoDarkStart(trimmed || null);
      setLocalValue(undefined); // reset to stored
      toast.success(trimmed ? "Auto dark time saved." : "Auto dark time cleared.");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    try {
      await setAutoDarkStart(null);
      setLocalValue(undefined);
      toast.success("Auto dark time cleared — using night daypart.");
    } finally {
      setSaving(false);
    }
  }

  if (stored === undefined) return null; // loading

  const isDirty = localValue !== undefined && localValue !== (stored ?? "");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="auto-dark-start">Dark mode starts at</Label>
        <p className="text-label text-text-subtle">
          Auto mode switches to dark at this time and back to light at 06:00.
          Leave empty to use your night daypart instead.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Input
          id="auto-dark-start"
          type="time"
          className="w-36"
          value={displayValue}
          onChange={(e) => setLocalValue(e.target.value)}
          disabled={saving}
        />

        {isDirty && (
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        )}

        {!isDirty && stored && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleClear}
            disabled={saving}
            className="text-text-muted"
          >
            Clear
          </Button>
        )}
      </div>

      {stored && !isDirty && (
        <p className="text-label text-text-subtle">
          Currently dark from{" "}
          <span className="font-medium text-text">{formatTime(stored)}</span> to{" "}
          <span className="font-medium text-text">06:00 AM</span>.
        </p>
      )}
    </div>
  );
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const date = new Date();
  date.setHours(h!, m!, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
