"use client";

import { useThemeMode } from "@/hooks/use-theme";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ThemeMode } from "@/lib/theme";

const MODES: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
];

export function ThemeToggle() {
  const { mode, resolved, setMode } = useThemeMode();

  return (
    <div className="flex items-center gap-3">
      <Tabs value={mode} onValueChange={(value) => setMode(value as ThemeMode)}>
        <TabsList>
          {MODES.map((m) => (
            <TabsTrigger key={m.value} value={m.value}>
              {m.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <span className="text-label text-text-subtle">
        {mode === "auto" ? `auto — currently ${resolved}` : resolved}
      </span>
    </div>
  );
}
