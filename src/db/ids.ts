// Row ids, and which of them are deterministic.
//
// Most rows carry a random UUID (`mutations.newId()`). Four kinds do not, and their
// ids are **derived from their content** so that two devices independently producing
// "the same" row produce the *same id* — which is what makes last-write-wins merging
// (D45) resolve instead of duplicate:
//
//   user       `local-user`                — v1 is single-user; a per-device UUID
//                                            would fork the one row that must not fork
//   daypart    `daypart-morning` …         — two fresh devices each seeding four
//                                            dayparts would otherwise sync to eight
//   plan week  `week-<weekStart>`          — D45 swaps the week wholesale, so both
//                                            devices must name it identically
//   plan slot  `plan-<stageId>-<date>`     — D54's one-session-per-stage-per-date rule
//                                            is *expressed as* this id colliding
//
// Because of this, those four `id` columns are Postgres `text`, not `uuid`
// (`db/server/schema.ts`). The determinism is load-bearing; the column type follows it,
// not the other way round.
//
// No Dexie, no Drizzle — both sides import from here.

/** The single v1 user (Architecture.md §5). Auth is additive, not a rewrite. */
export const LOCAL_USER_ID = "local-user";
