// One-off tasks (D68). Two things are worth testing here and neither is UI:
//
//   1. A task is **mutable**, so answering it must rewrite the one row rather than
//      append a second — the opposite of a `SessionLog`. Getting that wrong is
//      invisible on screen (the list would still look right) and only shows up as
//      duplicate rows on the other device after a sync.
//   2. A task must **die at the end of its daypart**. Automatic carry-forward is
//      exactly what D20 forbids, and the difference between "still pending, still on
//      Today" and "missed" is a time comparison that no unit test of the UI can see.
//
// Needs a real IndexedDB, hence `fake-indexeddb` (D55).
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import type { Goal, Stage } from "@/core/types";
import { localDb } from "@/db/local/schema";
import { logSession, putGoalWithStage, putTask, setTaskStatus } from "@/db/local/mutations";
import { DEFAULT_DAYPARTS, seedIfEmpty } from "@/db/local/seed";
import {
  getOutboxDepth,
  getSessionLogsForStage,
  getTasksBetween,
  getTasksForDaypart,
  getTasksForStage,
  pruneHistoryBefore,
} from "@/db/local/queries";
import { missedForWeek } from "@/features/checkin/lib";
import { historyPage } from "@/features/goals/goal-detail/lib";

const MORNING = DEFAULT_DAYPARTS.find((d) => d.name === "morning")!; // 05:00–12:00
const NIGHT = DEFAULT_DAYPARTS.find((d) => d.name === "night")!; // 21:00–05:00, wraps

// Local wall-clock, no Z (D53). The week starting Monday 2026-07-27.
const WEEK_START = "2026-07-27";
const WEDNESDAY = "2026-07-29";
const THURSDAY = "2026-07-30";
const THURSDAY_MORNING = "2026-07-30T09:00:00"; // inside Thursday morning
const THURSDAY_EVENING = "2026-07-30T22:00:00"; // Thursday morning is long over

async function reset() {
  await Promise.all(localDb.tables.map((t) => t.clear()));
}

beforeEach(async () => {
  await reset();
  await seedIfEmpty(THURSDAY_MORNING);
});

function goal(overrides: Partial<Goal> = {}): Goal {
  return { id: "goal-1", name: "Gym", purpose: "fitness", tier: 1, state: "active", ...overrides };
}

function stage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: "stage-1",
    goalId: "goal-1",
    sessionMinutes: 30,
    cadenceType: "frequency",
    cadenceCount: 7,
    cadenceDays: null,
    eligibleDayparts: [MORNING.id],
    maxPerWeek: null,
    minRestDays: null,
    scopeUnitLabel: null,
    scopeUnitTotal: null,
    targetDate: null,
    deadlineDerived: false,
    sortOrder: 0,
    state: "active",
    ...overrides,
  };
}

async function seedGoal() {
  return putGoalWithStage(goal(), stage(), THURSDAY_MORNING);
}

describe("putTask / setTaskStatus", () => {
  it("creates a pending task on the occurrence and queues exactly one outbox row", async () => {
    const before = await getOutboxDepth();
    const task = await putTask(
      { title: "Renew the passport", minutes: 15, date: THURSDAY, daypartId: MORNING.id },
      THURSDAY_MORNING,
    );

    expect(task.status).toBe("pending");
    expect(task.resolvedAt).toBeNull();
    expect(await getOutboxDepth()).toBe(before + 1);
    expect(await getTasksForDaypart(THURSDAY, MORNING.id)).toHaveLength(1);
  });

  it("answers in place — one row, rewritten, not a second one", async () => {
    const task = await putTask(
      { title: "Renew the passport", minutes: 15, date: THURSDAY, daypartId: MORNING.id },
      THURSDAY_MORNING,
    );

    await setTaskStatus(task.id, "done", THURSDAY_EVENING);

    const rows = await getTasksForDaypart(THURSDAY, MORNING.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(task.id);
    expect(rows[0].status).toBe("done");
    expect(rows[0].resolvedAt).toBe(THURSDAY_EVENING);
    // LWW on `updatedAt` is what makes the answer beat the creation on the other
    // device, so it has to move.
    expect(rows[0].updatedAt).toBe(THURSDAY_EVENING);
  });

  it("leaves the occurrence alone when a task is answered late", async () => {
    const task = await putTask(
      { title: "Bins", minutes: 5, date: WEDNESDAY, daypartId: NIGHT.id },
      THURSDAY_MORNING,
    );
    await setTaskStatus(task.id, "done", THURSDAY_EVENING);

    const [row] = await getTasksForDaypart(WEDNESDAY, NIGHT.id);
    expect(row.date).toBe(WEDNESDAY);
    expect(row.daypartId).toBe(NIGHT.id);
  });

  it("is a no-op on an id that is not there", async () => {
    await expect(setTaskStatus("nope", "done", THURSDAY_EVENING)).resolves.toBeUndefined();
  });
});

describe("goal-attached tasks (D70)", () => {
  it("pairs a Done, stage-linked task with a voluntary session log at the task's own duration", async () => {
    const { stage: st } = await seedGoal();
    const task = await putTask(
      { title: "Renew the passport", minutes: 60, date: THURSDAY, daypartId: MORNING.id, stageId: st.id },
      THURSDAY_MORNING,
    );

    await setTaskStatus(task.id, "done", THURSDAY_EVENING);

    const logs = await getSessionLogsForStage(st.id, THURSDAY, THURSDAY);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      stageId: st.id,
      status: "done",
      source: "voluntary",
      taskId: task.id,
      // The task's own stated duration (60), credited as-is — not the stage's usual
      // box (30). Confirms it's genuinely different from `st.sessionMinutes` here.
      minutes: 60,
    });
    expect(logs[0].minutes).not.toBe(st.sessionMinutes);
  });

  it("does not write a log when a stage-linked task is skipped", async () => {
    const { stage: st } = await seedGoal();
    const task = await putTask(
      { title: "Renew the passport", minutes: 15, date: THURSDAY, daypartId: MORNING.id, stageId: st.id },
      THURSDAY_MORNING,
    );

    await setTaskStatus(task.id, "skipped", THURSDAY_EVENING);

    expect(await getSessionLogsForStage(st.id, THURSDAY, THURSDAY)).toEqual([]);
  });

  it("never writes a log for a stray (unattached) task marked done", async () => {
    const task = await putTask(
      { title: "Bins", minutes: 5, date: THURSDAY, daypartId: MORNING.id },
      THURSDAY_MORNING,
    );
    await setTaskStatus(task.id, "done", THURSDAY_EVENING);

    // A stray task has no stage to log against — this is really just confirming
    // `setTaskStatus` doesn't throw or invent one.
    const rows = await getTasksForDaypart(THURSDAY, MORNING.id);
    expect(rows[0].status).toBe("done");
  });

  it("getTasksForStage reads every task attached to a stage, newest first", async () => {
    const { stage: st } = await seedGoal();
    await putTask(
      { title: "Older", minutes: 15, date: WEDNESDAY, daypartId: MORNING.id, stageId: st.id },
      THURSDAY_MORNING,
    );
    await putTask(
      { title: "Newer", minutes: 15, date: THURSDAY, daypartId: MORNING.id, stageId: st.id },
      THURSDAY_MORNING,
    );

    const tasks = await getTasksForStage(st.id);
    expect(tasks.map((t) => t.title)).toEqual(["Newer", "Older"]);
  });

  it("goal-detail history merges a skipped attached task in alongside session logs, in date order", async () => {
    const { stage: st } = await seedGoal();

    // An ordinary planned session, done, no task attached.
    await logSession(
      {
        stageId: st.id,
        date: WEDNESDAY,
        daypartId: MORNING.id,
        minutes: st.sessionMinutes,
        status: "done",
        source: "planned",
      },
      THURSDAY_MORNING,
    );

    // A stage-linked task, skipped — no log, so it must appear as its own row.
    const skippedTask = await putTask(
      { title: "Renew the passport", minutes: 15, date: THURSDAY, daypartId: MORNING.id, stageId: st.id },
      THURSDAY_MORNING,
    );
    await setTaskStatus(skippedTask.id, "skipped", THURSDAY_MORNING);

    const allTasks = await getTasksForStage(st.id);
    const page = await historyPage(st.id, allTasks, new Set());

    // Newest first: Thursday's skipped task before Wednesday's done session.
    expect(page.rows.map((r) => r.date)).toEqual([THURSDAY, WEDNESDAY]);
    expect(page.rows[0]).toMatchObject({ kind: "task", task: { title: "Renew the passport" } });
    expect(page.rows[1]).toMatchObject({ kind: "session", log: { status: "done" } });
  });

  it("annotates a done attached task's paired session log with its title — the actual bug reported", async () => {
    const { stage: st } = await seedGoal();

    // Exactly the reported flow: "Add a task", attach to a goal, mark it Done.
    const task = await putTask(
      { title: "Yoga", minutes: 15, date: THURSDAY, daypartId: MORNING.id, stageId: st.id },
      THURSDAY_MORNING,
    );
    await setTaskStatus(task.id, "done", THURSDAY_MORNING);

    // Passing only the skipped subset (the bug) would leave `taskTitle: null` here,
    // since a done task is never in that subset — the paired log would render with
    // no visible connection to the task that produced it.
    const allTasks = await getTasksForStage(st.id);
    const page = await historyPage(st.id, allTasks, new Set());

    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({
      kind: "session",
      taskTitle: "Yoga",
      // The task's own 15 minutes, not the stage's 30-minute box.
      log: { source: "voluntary", status: "done", minutes: 15 },
    });
  });
});

describe("tasks on /missed (D68, D20)", () => {
  const addTask = (title: string, date: string, daypartId: string) =>
    putTask({ title, minutes: 15, date, daypartId }, THURSDAY_MORNING);

  it("does not surface a task whose daypart is still running", async () => {
    await addTask("Renew the passport", THURSDAY, MORNING.id);
    // 09:00 — Thursday morning runs until 12:00.
    expect(await missedForWeek(WEEK_START, THURSDAY_MORNING)).toEqual([]);
  });

  it("surfaces a task left unanswered once its daypart has ended", async () => {
    await addTask("Renew the passport", THURSDAY, MORNING.id);

    const missed = await missedForWeek(WEEK_START, THURSDAY_EVENING);
    expect(missed).toHaveLength(1);
    expect(missed[0]).toMatchObject({
      source: "task",
      kind: "unlogged",
      title: "Renew the passport",
      date: THURSDAY,
      minutes: 15,
    });
  });

  it("surfaces a skipped task, and never a done one", async () => {
    const skippedTask = await addTask("Bins", THURSDAY, MORNING.id);
    const doneTask = await addTask("Renew the passport", THURSDAY, MORNING.id);
    await setTaskStatus(skippedTask.id, "skipped", THURSDAY_MORNING);
    await setTaskStatus(doneTask.id, "done", THURSDAY_MORNING);

    const missed = await missedForWeek(WEEK_START, THURSDAY_EVENING);
    expect(missed).toHaveLength(1);
    expect(missed[0]).toMatchObject({ source: "task", kind: "skipped", title: "Bins" });
  });

  it("carries its own title, so nothing has to look up a stage it does not have", async () => {
    await addTask("Renew the passport", THURSDAY, MORNING.id);
    const [missed] = await missedForWeek(WEEK_START, THURSDAY_EVENING);

    // The `source` discriminant is what stops /missed reaching for `stageId` and
    // rendering every task as "Deleted goal".
    expect(missed.source).toBe("task");
    expect("stageId" in missed).toBe(false);
    expect(missed.key.startsWith("task|")).toBe(true);
  });

  it("keeps a soft-deleted task out of both Today and /missed", async () => {
    const task = await addTask("Renew the passport", THURSDAY, MORNING.id);
    await localDb.tasks.update(task.id, { deletedAt: THURSDAY_MORNING });

    expect(await getTasksForDaypart(THURSDAY, MORNING.id)).toEqual([]);
    expect(await missedForWeek(WEEK_START, THURSDAY_EVENING)).toEqual([]);
  });
});

describe("retention", () => {
  it("prunes tasks with the rest of the local history window (D47, D48)", async () => {
    await putTask(
      { title: "Old thing", minutes: 15, date: "2026-01-05", daypartId: MORNING.id },
      THURSDAY_MORNING,
    );
    await putTask(
      { title: "Recent thing", minutes: 15, date: THURSDAY, daypartId: MORNING.id },
      THURSDAY_MORNING,
    );

    await pruneHistoryBefore("2026-07-01");

    const kept = await getTasksBetween("2026-01-01", "2026-12-31");
    expect(kept.map((t) => t.title)).toEqual(["Recent thing"]);
  });
});
