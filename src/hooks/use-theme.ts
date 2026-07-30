"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  applyResolvedTheme,
  getStoredMode,
  resolveTheme,
  setStoredMode,
  subscribeThemeMode,
  type ResolvedTheme,
  type ThemeMode,
} from "@/lib/theme";

function getServerMode(): ThemeMode {
  return "auto";
}

function getServerResolved(): ResolvedTheme {
  return "light";
}

export function useThemeMode() {
  const mode = useSyncExternalStore(
    subscribeThemeMode,
    getStoredMode,
    getServerMode,
  );
  const resolved = useSyncExternalStore(
    subscribeThemeMode,
    () => resolveTheme(mode),
    getServerResolved,
  );

  const setMode = useCallback((next: ThemeMode) => {
    setStoredMode(next);
    applyResolvedTheme(resolveTheme(next));
  }, []);

  return { mode, resolved, setMode };
}
