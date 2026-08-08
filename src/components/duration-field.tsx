"use client";

// Hours + minutes input for session length — most sessions run an hour or
// more, and a single "minutes" field makes those tedious to type ("90"). Each
// half holds free text while focused and only coerces to the combined total
// minutes on blur, the same edge-coercion pattern as `NumberField`.

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface DurationFieldProps {
  idPrefix: string;
  value: number; // total minutes
  onChange: (minutes: number) => void;
  min?: number; // minimum total minutes
}

export function DurationField({ idPrefix, value, onChange, min = 1 }: DurationFieldProps) {
  const [prevValue, setPrevValue] = useState(value);
  const [hoursText, setHoursText] = useState(String(Math.floor(value / 60)));
  const [minutesText, setMinutesText] = useState(String(value % 60));

  // Resync from an external value change without fighting in-progress typing
  // — React's adjust-during-render pattern, not an effect (see NumberField).
  if (value !== prevValue) {
    setPrevValue(value);
    setHoursText(String(Math.floor(value / 60)));
    setMinutesText(String(value % 60));
  }

  function commit(hoursRaw: string, minutesRaw: string) {
    const hoursParsed = Number(hoursRaw);
    const minutesParsed = Number(minutesRaw);
    const hours =
      hoursRaw.trim() === "" || Number.isNaN(hoursParsed) ? 0 : Math.max(0, Math.trunc(hoursParsed));
    const minutes =
      minutesRaw.trim() === "" || Number.isNaN(minutesParsed)
        ? 0
        : Math.max(0, Math.trunc(minutesParsed));
    const total = Math.max(min, hours * 60 + minutes);

    setHoursText(String(Math.floor(total / 60)));
    setMinutesText(String(total % 60));
    if (total !== value) onChange(total);
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex gap-1.5">
        <Input
          id={`${idPrefix}-hours`}
          type="number"
          min={0}
          className="w-16 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          value={hoursText}
          onChange={(e) => setHoursText(e.target.value)}
          onBlur={(e) => commit(e.target.value, minutesText)}
        />
        <Label htmlFor={`${idPrefix}-hours`}>H</Label>
        <Input
          id={`${idPrefix}-minutes`}
          type="number"
          min={0}
          max={59}
          className="w-16 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          value={minutesText}
          onChange={(e) => setMinutesText(e.target.value)}
          onBlur={(e) => commit(hoursText, e.target.value)}
        />
        <Label htmlFor={`${idPrefix}-minutes`}>M</Label>
      </div>
    </div>
  );
}
