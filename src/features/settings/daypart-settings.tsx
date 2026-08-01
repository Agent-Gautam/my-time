"use client";

// Daypart boundaries and per-daypart active cap — fully user-defined (D7, D11).
// Each row edits independently; saving one re-lays-out the week since a moved
// boundary can invalidate slots already placed against the old one.

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { getDayparts } from "@/db/local/queries";
import { putDaypart } from "@/db/local/mutations";
import { localNow } from "@/lib/daypart";
import { relayoutWeek } from "@/features/plan/planner";
import type { LocalDaypart } from "@/db/local/schema";

function DaypartRow({ daypart }: { daypart: LocalDaypart }) {
  const [name, setName] = useState(daypart.name);
  const [startTime, setStartTime] = useState(daypart.startTime);
  const [endTime, setEndTime] = useState(daypart.endTime);
  const [activeCap, setActiveCap] = useState(String(daypart.activeCap));
  const [saving, setSaving] = useState(false);

  const dirty =
    name !== daypart.name ||
    startTime !== daypart.startTime ||
    endTime !== daypart.endTime ||
    activeCap !== String(daypart.activeCap);

  async function handleSave() {
    setSaving(true);
    try {
      const now = localNow();
      const cap = Math.max(0, Math.trunc(Number(activeCap)) || 0);
      await putDaypart(
        {
          id: daypart.id,
          name: name.trim() || daypart.name,
          startTime,
          endTime,
          activeCap: cap,
          sortOrder: daypart.sortOrder,
        },
        now,
      );
      // A moved boundary can strand slots that were placed under the old one.
      await relayoutWeek({ now });
      toast.success(`${name.trim() || daypart.name} updated.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={`${daypart.id}-name`}>Name</Label>
          <Input
            id={`${daypart.id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${daypart.id}-start`}>Starts</Label>
          <Input
            id={`${daypart.id}-start`}
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${daypart.id}-end`}>Ends</Label>
          <Input
            id={`${daypart.id}-end`}
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
        <div className="flex w-32 flex-col gap-1.5">
          <Label htmlFor={`${daypart.id}-cap`}>Active cap</Label>
          <Input
            id={`${daypart.id}-cap`}
            type="number"
            min={0}
            className="w-20"
            value={activeCap}
            onChange={(e) => setActiveCap(e.target.value)}
          />
          <p className="text-label text-text-subtle">
            Max goals scheduled into this daypart at once.
          </p>
        </div>
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={handleSave}
          className="sm:mb-0.5"
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function DaypartSettings() {
  const dayparts = useLiveQuery(() => getDayparts(), []);

  if (dayparts === undefined) {
    return <p className="text-body text-text-muted">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {dayparts.map((daypart) => (
        <DaypartRow key={daypart.id} daypart={daypart} />
      ))}
    </div>
  );
}
