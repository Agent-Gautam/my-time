// POST /api/reset-tracking — user-initiated clean slate (implementation_plan.md).
//
// Deletes all tracking data for LOCAL_USER_ID from Postgres in FK-safe order:
// session_logs, checkpoints, check_ins, tasks, plan_weeks (plan_slots cascade).
// Goals, stages, dayparts, users, and push subscriptions are untouched.
//
// This is an explicit user purge, not a normal lifecycle event. D48 applies to
// regular mutations; this is the same documented exception as removing test data.
// Auth is the same shared-key check as /api/sync (D59).

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/server/client";
import {
  checkIns,
  checkpoints,
  planWeeks,
  sessionLogs,
  tasks,
} from "@/db/server/schema";
import { LOCAL_USER_ID } from "@/db/ids";
import { SYNC_KEY_HEADER } from "@/sync/transport";

const SYNC_KEY = process.env.NEXT_PUBLIC_SYNC_KEY ?? "";

export async function POST(request: Request): Promise<NextResponse> {
  // Same lightweight key check as /api/sync (D59).
  if (SYNC_KEY) {
    const provided = request.headers.get(SYNC_KEY_HEADER);
    if (provided !== SYNC_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Delete in FK order so no constraint fires.
  // session_logs references tasks (task_id), so logs go before tasks.
  // plan_slots has a FK cascade from plan_weeks — deleting plan_weeks is sufficient
  // and avoids a subquery to scope slots by userId.
  await db.transaction(async (tx) => {
    await tx.delete(sessionLogs);
    await tx.delete(checkpoints);
    await tx.delete(checkIns).where(eq(checkIns.userId, LOCAL_USER_ID));
    await tx.delete(tasks).where(eq(tasks.userId, LOCAL_USER_ID));
    await tx.delete(planWeeks).where(eq(planWeeks.userId, LOCAL_USER_ID));
    // plan_slots are removed by the FK cascade on planWeeks.onDelete("cascade").
  });

  return NextResponse.json({ ok: true });
}
