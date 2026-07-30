// POST /api/push/subscribe — persists a browser's Web Push subscription (Architecture.md
// §5, D36). Route handlers under src/app/api/** are the one place exempt from the UI's
// no-fetch/no-db-server rule (D33, D42) — this is the boundary, not a UI screen.

import { NextResponse } from "next/server";

import { db } from "@/db/server/client";
import { pushSubscriptions, users } from "@/db/server/schema";
import { LOCAL_USER_ID } from "@/db/ids";

interface SubscribePayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  deviceLabel?: string;
}

function isSubscribePayload(body: unknown): body is SubscribePayload {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.endpoint !== "string" || b.endpoint.length === 0) return false;
  if (typeof b.keys !== "object" || b.keys === null) return false;
  const keys = b.keys as Record<string, unknown>;
  return typeof keys.p256dh === "string" && typeof keys.auth === "string";
}

// `users` holds exactly one row in v1 (Architecture.md §5) and nothing seeds it
// server-side yet — auth is deferred. Resolve-or-create keeps this endpoint usable
// standalone rather than depending on a sync endpoint that doesn't exist yet.
//
// The id is the deterministic LOCAL_USER_ID, not a fresh UUID: the client seeds the
// same value (`db/local/seed.ts`), so whichever side writes first, sync converges on
// one row instead of forking it (`db/ids.ts`).
async function ensureSingleUser(): Promise<string> {
  await db.insert(users).values({ id: LOCAL_USER_ID }).onConflictDoNothing();
  return LOCAL_USER_ID;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isSubscribePayload(body)) {
    return NextResponse.json(
      { error: "Expected { endpoint, keys: { p256dh, auth }, deviceLabel? }." },
      { status: 400 },
    );
  }

  const userId = await ensureSingleUser();

  // Idempotent on `endpoint` (unique) — re-subscribing (e.g. after a key rotation
  // Chrome performs periodically) updates the row rather than erroring.
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      deviceLabel: body.deviceLabel,
      deletedAt: null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        deviceLabel: body.deviceLabel,
        deletedAt: null,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ ok: true }, { status: 201 });
}
