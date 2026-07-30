"use client";

// The entry point for push (D36). Wave 2c built the endpoints, the worker handlers
// and lib/push.ts, but nothing called them — a browser only ever prompts for
// notification permission in response to a user gesture, so there has to be a button
// somewhere. This is it.
//
// The nudge itself is content-free by design (D37b): the scheduler runs on the client
// (D34), so the server has no plan to describe. The copy here says so plainly rather
// than implying the notification will tell you what to do.
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  isPushSupported,
  requestPushPermission,
  subscribeToPush,
} from "@/lib/push";

type Status = "loading" | "unsupported" | "default" | "granted" | "denied";

// Permission is a browser fact, not React state — read through the primitive React
// provides for exactly that, as lib/theme.ts and use-sync-status.ts both do. The
// browser fires no event when permission changes, so notifying listeners after the
// user answers the prompt is what re-reads it.
const permissionListeners = new Set<() => void>();

function subscribePermission(listener: () => void): () => void {
  permissionListeners.add(listener);
  return () => permissionListeners.delete(listener);
}

function bumpPermission() {
  permissionListeners.forEach((l) => l());
}

function getPermissionSnapshot(): Status {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission as Status;
}

// "loading" on the server and on the first client render, so nothing flashes before
// the real permission is known.
const getServerPermissionSnapshot = (): Status => "loading";

export function NotificationSettings() {
  const status = useSyncExternalStore(
    subscribePermission,
    getPermissionSnapshot,
    getServerPermissionSnapshot,
  );
  const [busy, setBusy] = useState(false);

  const enable = async () => {
    setBusy(true);
    try {
      const permission = await requestPushPermission();
      bumpPermission();

      if (permission !== "granted") {
        toast("Reminders stay off. Nothing else changes.");
        return;
      }

      await subscribeToPush(navigator.userAgent);
      toast("Reminders on for this device.");
    } catch {
      // Most likely NEXT_PUBLIC_VAPID_PUBLIC_KEY missing in this environment.
      toast("Couldn't turn reminders on. The rest of the app is unaffected.");
      bumpPermission();
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading") return null;

  if (status === "unsupported") {
    return (
      <p className="text-label text-text-muted">
        This browser doesn&rsquo;t support push notifications.
      </p>
    );
  }

  if (status === "granted") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-label text-text-muted">
          Reminders are on for this device.
        </p>
        <Button
          variant="ghost"
          className="min-h-11 self-start"
          disabled={busy}
          onClick={enable}
        >
          Re-register this device
        </Button>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <p className="text-label text-text-muted">
        Notifications are blocked for this site. Turn them back on in your
        browser&rsquo;s site settings, then reload.
      </p>
    );
  }

  return (
    <Button className="min-h-11 self-start" disabled={busy} onClick={enable}>
      Turn on reminders
    </Button>
  );
}
