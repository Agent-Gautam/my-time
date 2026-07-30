"use client";

import { useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getOutboxDepth } from "@/db/local/queries";

export type SyncStatus = "synced" | "syncing" | "offline" | "pending";

interface SyncStatusData {
  status: SyncStatus;
  pendingCount: number;
  isOnline: boolean;
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
 * Wave 3 extends this with the real `syncing` state and a last-pull timestamp; the
 * shape here is the seam.
 */
export function useSyncStatus(): SyncStatusData {
  const isOnline = useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    getServerOnlineSnapshot,
  );

  const pendingCount = useLiveQuery(() => getOutboxDepth(), [], 0);

  const status: SyncStatus = !isOnline
    ? "offline"
    : pendingCount > 0
      ? "pending"
      : "synced";

  return { status, pendingCount, isOnline };
}
