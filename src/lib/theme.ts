export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "my-time:theme-mode";

const RESOLVED_THEMES: ResolvedTheme[] = ["light", "dark"];

// Shape mirrors core/types.ts's Daypart (startTime/endTime as "HH:mm") without
// importing it — lib/ can depend on core/, but the field this needs is this small.
export interface DaypartBoundary {
  name: string;
  startTime: string;
  endTime: string;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// Wired to the user's own dayparts (D7) by hooks/use-theme.ts, which reads them
// live from Dexie. Falls back to the OS preference until dayparts are loaded, or
// on a fresh device with no "night" daypart yet.
//
// If `autoDarkStart` is set by the user (Settings → Theme), it overrides the
// "night daypart" heuristic: dark from autoDarkStart until 06:00 the next morning.
function resolveAutoTheme(
  now: Date,
  autoDarkStart: string | null,
  dayparts?: DaypartBoundary[],
): ResolvedTheme {
  // 1. Explicit user-configured dark-start time takes priority.
  if (autoDarkStart) {
    const minutes = now.getHours() * 60 + now.getMinutes();
    const start = minutesOf(autoDarkStart);
    const end = 6 * 60; // fixed dawn at 06:00
    // Dark window wraps midnight (e.g. 21:00 → 06:00 next day).
    const inDark =
      start >= end
        ? minutes >= start || minutes < end
        : minutes >= start && minutes < end;
    return inDark ? "dark" : "light";
  }

  // 2. Legacy: look for a daypart named "night" and use its boundaries.
  const night = dayparts?.find((d) => d.name.toLowerCase() === "night");
  if (night) {
    const minutes = now.getHours() * 60 + now.getMinutes();
    const start = minutesOf(night.startTime);
    const end = minutesOf(night.endTime);
    const inNight =
      start < end
        ? minutes >= start && minutes < end
        : minutes >= start || minutes < end; // wraps past midnight
    return inNight ? "dark" : "light";
  }
  return getSystemTheme();
}

export function resolveTheme(
  mode: ThemeMode,
  autoDarkStart: string | null,
  dayparts?: DaypartBoundary[],
  now: Date = new Date(),
): ResolvedTheme {
  return mode === "auto" ? resolveAutoTheme(now, autoDarkStart, dayparts) : mode;
}

export function getStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "auto"
    ? stored
    : "auto";
}

export function setStoredMode(mode: ThemeMode) {
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  notify();
}

export function applyResolvedTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  for (const t of RESOLVED_THEMES) root.classList.remove(`theme-${t}`);
  root.classList.add(`theme-${resolved}`);
}

// A tiny external store so useThemeMode (hooks/use-theme.ts) can read this via
// useSyncExternalStore instead of effect+setState — mode/resolved genuinely
// live outside React (localStorage, matchMedia), and this is the primitive
// React provides for exactly that, without an SSR hydration mismatch.
type Listener = () => void;
const listeners = new Set<Listener>();
let mediaSubscribed = false;

function notify() {
  listeners.forEach((listener) => listener());
}

function ensureMediaSubscription() {
  if (mediaSubscribed || typeof window === "undefined") return;
  mediaSubscribed = true;
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", notify);
}

export function subscribeThemeMode(listener: Listener): () => void {
  ensureMediaSubscription();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
