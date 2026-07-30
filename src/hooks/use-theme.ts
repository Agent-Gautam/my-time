"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { getDayparts } from "@/db/local/queries";
import {
  applyResolvedTheme,
  getStoredMode,
  resolveTheme,
  setStoredMode,
  subscribeThemeMode,
  type DaypartBoundary,
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

  // The user's own dayparts (D7), so `auto` follows "the night daypart" instead of
  // the OS's guess at 6pm (design.md §3). `undefined` while first loading — that
  // still resolves via resolveAutoTheme's OS fallback rather than blocking on it.
  const dayparts: DaypartBoundary[] | undefined = useLiveQuery(
    () => getDayparts(),
    [],
  );

  const resolved = useSyncExternalStore(
    subscribeThemeMode,
    () => resolveTheme(mode, dayparts),
    getServerResolved,
  );

  // Dayparts arrive asynchronously (Dexie is never ready on first render), so the
  // resolved theme applied by the inline head script may be stale by the time this
  // mounts. Re-apply once the live dayparts are known — a no-op cross-fade if they
  // agree (design.md §6.3).
  useEffect(() => {
    applyResolvedTheme(resolveTheme(mode, dayparts));
  }, [mode, dayparts]);

  const setMode = useCallback(
    (next: ThemeMode) => {
      setStoredMode(next);
      applyResolvedTheme(resolveTheme(next, dayparts));
    },
    [dayparts],
  );

  return { mode, resolved, setMode };
}
