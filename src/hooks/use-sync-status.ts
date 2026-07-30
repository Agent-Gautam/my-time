"use client";

import { useEffect, useState } from "react";
import { getOutboxDepth } from "@/db/local/queries";

export type SyncStatus = "synced" | "syncing" | "offline" | "pending";

interface SyncStatusData {
  status: SyncStatus;
  pendingCount: number;
  isOnline: boolean;
}

/**
 * Tracks sync status for the always-visible indicator (D46).
 * Currently uses navigator.onLine + outbox depth.
 * Wave 3 will extend this with syncing state and last-pull timestamp.
 */
export function useSyncStatus(): SyncStatusData {
  const [data, setData] = useState<SyncStatusData>({
    status: "synced",
    pendingCount: 0,
    isOnline: true,
  });

  // Monitor network status
  useEffect(() => {
    const handleOnline = () =>
      setData((d) => ({ ...d, isOnline: true }));
    const handleOffline = () =>
      setData((d) => ({ ...d, isOnline: false }));

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Poll outbox depth
  useEffect(() => {
    const check = async () => {
      const depth = await getOutboxDepth();
      setData((d) => ({ ...d, pendingCount: depth }));
    };

    // Initial check
    check();

    // Poll every 2 seconds
    const interval = setInterval(check, 2000);
    return () => clearInterval(interval);
  }, []);

  // Derive status: offline > pending > synced
  const status: SyncStatus =
    !data.isOnline ? "offline" :
    data.pendingCount > 0 ? "pending" :
    "synced";

  return { ...data, status };
}
