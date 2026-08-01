"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getOutboxDepth } from "@/db/local/queries";
import { relayoutWeek } from "@/features/plan/planner";
import {
  getServerSyncEngineSnapshot,
  getSyncEngineSnapshot,
  startSync,
  subscribeSyncEngine,
} from "@/sync";
import type { IsoDateTime } from "@/core/types";

export type SyncStatus = "synced" | "syncing" | "offline" | "pending" | "blocked";

interface SyncStatusData {
  status: SyncStatus;
  pendingCount: number;
  isOnline: boolean;
  /** When the last pull completed, or null if this device has never pulled. Local
   *  wall-clock (D53) — the same convention as every other timestamp in the app. */
  lastPullAt: IsoDateTime | null;
}

// Online-ness lives outside React (it is a browser event source), so it is read
// through useSyncExternalStore rather than effect+setState — the same primitive
// lib/theme.ts uses for matchMedia, and the one that avoids an SSR mismatch.
function subscribeOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

// Read live rather than seeded once: a page loaded while already offline fires no
// `offline` event, so an assumed-online initial value would report "synced" until
// the network happened to change. Offline is the default path here (D33), not the
// exception.
const getOnlineSnapshot = () => navigator.onLine;
const getServerOnlineSnapshot = () => true;

/**
 * Tracks sync status for the always-visible indicator (D46).
 *
 * Outbox depth comes from `useLiveQuery`, so it reacts to Dexie writes instead of
 * polling. A `setInterval` waking every 2s on every route would run forever on a
 * budget Android phone for a value that only changes when something is written
 * (D47).
 *
 * Wave 3 filled in the seam this was built for. Two additions, no rewrite:
 *
 *   - `syncing` is now real — the engine publishes it through an external store, read
 *     with the same `useSyncExternalStore` pattern as online-ness, `getServerSnapshot`
 *     included so SSR doesn't throw.
 *   - `lastPullAt` completes §6.1's definition of *synced*: "outbox empty **and last
 *     pull recent**". The hook reports the fact; nothing here decides what "recent"
 *     means, and nothing offers the user an action (D46).
 *
 * It is also where sync starts. The indicator is mounted for the whole session by
 * definition, so "the status hook mounted" and "the app started" are the same event —
 * which is what makes the app-start flush automatic rather than a screen's job.
 * `startSync` is idempotent and a no-op during SSR.
 *
 * Precedence: offline > syncing > pending > synced. Offline stays first because a
 * flush in flight when the network drops is not information the user can use; "your
 * writes are queuing normally" is.
 */
export function useSyncStatus(): SyncStatusData {
  const isOnline = useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    getServerOnlineSnapshot,
  );

  const engine = useSyncExternalStore(
    subscribeSyncEngine,
    getSyncEngineSnapshot,
    getServerSyncEngineSnapshot,
  );

  const pendingCount = useLiveQuery(() => getOutboxDepth(), [], 0);

  // Also the composition root for re-planning after a pull (D62). `sync/` sits below
  // `features/` and so cannot import `relayoutWeek` itself; this hook is already the
  // one place that starts the engine, and it is on the UI side of the seam, so it is
  // where the two get introduced. `startSync` remains idempotent — passing the
  // function again on a remount just re-registers the same thing.
  useEffect(() => {
    startSync((now) => relayoutWeek({ now }));
  }, []);

  // `blocked` sits just under `offline`: while offline, "your writes are queuing
  // normally" is still the more useful thing to say, and a rejected key is not
  // actionable until there is a network anyway. Above `pending`, though — a wedged
  // outbox must never render as ordinary queuing (D59).
  const status: SyncStatus = !isOnline
    ? "offline"
    : engine.blocked
      ? "blocked"
      : engine.syncing
        ? "syncing"
        : pendingCount > 0
          ? "pending"
          : "synced";

  return { status, pendingCount, isOnline, lastPullAt: engine.lastPullAt };
}
