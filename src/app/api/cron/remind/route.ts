// GET /api/cron/remind — sends the daypart check-in nudge to every stored subscription.
// Called by Supabase pg_cron (see drizzle/manual-pg-cron-remind.sql), not Vercel's
// built-in cron — Hobby cron cannot hit the required frequency/precision (D37).
//
// The nudge is deliberately content-free: "time to check in", never what's in the plan.
// The scheduler lives on the client (D34); the server has no plan to describe (D37b).
// Do not add plan-awareness here — that would need a server-side scheduler, which is
// the exact coupling D33/D34 removed.

import { NextResponse } from "next/server";
import webpush from "web-push";

import { db } from "@/db/server/client";
import { pushSubscriptions } from "@/db/server/schema";
import { eq, isNull } from "drizzle-orm";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      "VAPID env vars are not set — see .env.example (NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT).",
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

const NUDGE_PAYLOAD = JSON.stringify({
  title: "Time to check in",
  body: "",
});

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  configureWebPush();

  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(isNull(pushSubscriptions.deletedAt));

  let sent = 0;
  let pruned = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          NUDGE_PAYLOAD,
        );
        sent += 1;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Gone — the browser dropped the subscription. Soft-delete, never
          // hard-delete (matches the tombstone pattern the rest of the schema uses).
          await db
            .update(pushSubscriptions)
            .set({ deletedAt: new Date() })
            .where(eq(pushSubscriptions.id, sub.id));
          pruned += 1;
        }
      }
    }),
  );

  return NextResponse.json({ sent, pruned });
}
