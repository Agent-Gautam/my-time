// POST /api/reset-everything — nuclear reset: deletes the user row, which cascades
// to every table that has a FK to users (goals, stages, dayparts, session_logs,
// checkpoints, check_ins, tasks, plan_weeks/slots, push_subscriptions).
//
// Called by the "Reset Everything" action in Settings. After this the server has
// no data for LOCAL_USER_ID. The client re-seeds on next mount.
//
// Auth: same shared-key check as /api/sync (D59).

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/server/client";
import { users } from "@/db/server/schema";
import { LOCAL_USER_ID } from "@/db/ids";
import { SYNC_KEY_HEADER } from "@/sync/transport";

const SYNC_KEY = process.env.NEXT_PUBLIC_SYNC_KEY ?? "";

export async function POST(request: Request): Promise<NextResponse> {
  if (SYNC_KEY) {
    const provided = request.headers.get(SYNC_KEY_HEADER);
    if (provided !== SYNC_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Deleting the user row cascades to every dependent table:
  // dayparts, goals → stages → session_logs, checkpoints, plan_weeks → plan_slots,
  // check_ins, tasks, push_subscriptions.
  await db.delete(users).where(eq(users.id, LOCAL_USER_ID));

  return NextResponse.json({ ok: true });
}
