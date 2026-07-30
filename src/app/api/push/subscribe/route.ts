// POST /api/push/subscribe — persists a browser's Web Push subscription (Architecture.md
// §5, D36). Route handlers under src/app/api/** are the one place exempt from the UI's
// no-fetch/no-db-server rule (D33, D42) — this is the boundary, not a UI screen.

import { NextResponse } from "next/server";

import { db } from "@/db/server/client";
import { pushSubscriptions, users } from "@/db/server/schema";

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
// server-side yet — auth is deferred (D36 predates it). Resolve-or-create keeps this
// endpoint usable standalone rather than depending on a sync endpoint that doesn't
// exist yet.
async function getSingleUserId(): Promise<string> {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing[0]) return existing[0].id;
  const inserted = await db.insert(users).values({}).returning({ id: users.id });
  return inserted[0].id;
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

  const userId = await getSingleUserId();

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
