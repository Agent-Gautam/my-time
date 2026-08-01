"use client";

// A number input whose typed text is free while the field has focus and only
// coerced (clamped, defaulted) on blur. Fixes the bug where coercing on every
// keystroke (`Math.max(1, Number(e.target.value))`) snaps a cleared field
// straight back to its minimum before the user can retype it.

import { useState } from "react";

import { Input } from "@/components/ui/input";

export interface NumberFieldProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  className?: string;
  placeholder?: string;
}

export function NumberField({
  id,
  value,
  onChange,
  min = 0,
  className,
  placeholder,
}: NumberFieldProps) {
  const [prevValue, setPrevValue] = useState(value);
  const [text, setText] = useState(String(value));

  // Resync from an external value change (e.g. loading a different record)
  // without fighting in-progress typing — React's adjust-during-render
  // pattern, not an effect, since an effect here would cascade an extra render.
  if (value !== prevValue) {
    setPrevValue(value);
    setText(String(value));
  }

  function commit(raw: string) {
    const parsed = Number(raw);
    const coerced =
      raw.trim() === "" || Number.isNaN(parsed) ? min : Math.max(min, Math.trunc(parsed));
    setText(String(coerced));
    if (coerced !== value) onChange(coerced);
  }

  return (
    <Input
      id={id}
      type="number"
      min={min}
      className={className}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
    />
  );
}
