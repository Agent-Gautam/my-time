# my-time — Memory

Working state across sessions. **Update at the end of every session** — this is the
handoff, and with parallel tracks running it is the only shared view of progress.

**Conflict rule:** append under **your own track heading only**. Do not rewrite other
tracks' sections.

---

## Where things stand

**Phase:** Wave 0 complete → Wave 1's four tracks are unblocked.
**Live:** https://my-time-nu-brown.vercel.app (auto-deploys from `main`).
All six planning documents are done.

| Document | State |
|---|---|
| `docs/PRD.md` | ✅ signed off |
| `docs/Architecture.md` | ✅ drafted |
| `docs/DECISIONS.md` | ✅ 52 decisions, live — append as you go |
| `CLAUDE.md` | ✅ written (replaced the planned `rules.md`, D49) |
| `docs/Phases.md` | ✅ written |
| `docs/design.md` | ✅ drafted — Track C unblocked |
| `docs/memory.md` | ✅ this file |

## Next action

**Wave 1** — four tracks (A scheduler, B data layer, C design system, D shell/PWA/push)
can now start in parallel, each in its own `git worktree` per `Phases.md`'s conflict
rules. Track A (the scheduler) is the one to give the most capable session.

---

## Track log

### Wave 0 — Foundation
**Done.**

- `create-next-app` (TS, App Router, Tailwind v4, ESLint, `src/`) + `shadcn/ui init`
  (style `base-nova`, first component `button.tsx`).
- GitHub repo: https://github.com/Agent-Gautam/my-time (public). Vercel project
  `gautam-anands-projects/my-time` linked to it; `main` auto-deploys to
  https://my-time-nu-brown.vercel.app (verified 200).
- Supabase project `my-time` (ref `xpczvrctuvaoqrpayfge`, org "Personal", region
  `ap-south-1`). Pooler connection string in `.env.local` (gitignored); required env
  vars documented in `.env.example` (`DATABASE_URL`, VAPID keypair, `CRON_SECRET`).
- Installed the full stack from `Architecture.md` §3: `drizzle-orm` + `postgres` +
  `drizzle-kit`, `dexie` + `dexie-react-hooks`, `@serwist/next` + `serwist`, `web-push`,
  `vitest`. `package.json` should not need touching again outside Wave 1 tracks adding
  their own deps.
- `src/core/types.ts` written and frozen — `Goal`, `Stage`, `Daypart`, `SessionLog`,
  `Checkpoint`, `PlanSlot`, `CheckIn` per `Architecture.md` §5. Types only.
- ESLint (`eslint.config.mjs`) enforces both CLAUDE.md invariants via
  `no-restricted-imports`/`no-restricted-syntax`: `src/core/**` can't import `db/`,
  `app/`, `sync/`, or `react`; `src/app/**` + `src/features/**` (excluding
  `app/api/**`) can't import `db/server/` or call `fetch`.
- `npm run` scripts match `CLAUDE.md` exactly, plus `start` (Next.js prod runtime).
  `db:generate`/`db:migrate` are wired to `drizzle.config.ts` but won't resolve until
  Track B adds `src/db/server/schema.ts` — expected, not a bug.
- GitHub Actions CI (`.github/workflows/ci.yml`) runs lint + test on push/PR.

**Gotchas hit along the way:**

- **A second session was drafting `docs/design.md` in this same checkout at the same
  time**, against `Phases.md`'s "Wave 0 runs alone" rule. Its `git add -A` swept up
  this session's in-progress scaffold into one tangled commit. No content was lost, but
  the history was split back into three clean commits before the first push (design.md
  · scaffold+types+ESLint · Drizzle/CI/env wiring) since nothing had been pushed yet.
  If running sessions in parallel, use `git worktree` from the start, per `Phases.md`.
- **Supabase pooler hostname isn't `aws-0-<region>`** — for this project it's
  `aws-1-ap-south-1.pooler.supabase.com:6543`. Don't assume the node number; verify
  with a live connection before writing it down.
- **`supabase orgs list` didn't show the "Personal" org on the first call** — a second
  call surfaced it. If the org you expect is missing, re-list before picking a
  different one.

### Track A — Scheduler (`core/`)
**Done.** All six modules implemented in `src/core/`, test-first, on branch `track/core`
(worktree `../my-time-core`): `constants.ts`, `score.ts`, `pace.ts`, `explain.ts`,
`reconcile.ts`, `layout.ts` — plus two small internal helpers, `dateUtils.ts` (all date
arithmetic takes explicit `IsoDate`/`IsoDateTime` input, never `new Date()`/`Date.now()`,
per D34) and shared cadence-window helpers exported from `score.ts`.

55 tests in `tests/core/`, one file per module, covering every rule in `Architecture.md`
§4.2 by name (determinism, idempotence/recompute-never-patch, past-immutability, churn
minimisation, scarcity-first D9, pack-not-sort knapsack D27, no-partial-sessions, fixed
time-box). `npm run lint` and `npm run test` both pass clean (0 errors, 0 warnings);
`tsc --noEmit` clean.

**Signature note — not a `core/types.ts` gap, but flagging per `Phases.md`'s "A
discovers, B follows" rule anyway:** `Architecture.md` §4.1's `layoutWeek` snippet lists
only `goals`/`dayparts`/`history`/`existing`/`weekStart`. Every field it needs already
exists in the frozen `types.ts` — nothing there needed to change — but the illustrative
signature itself was missing three inputs, all added:
- `stages: Stage[]` — `Goal` has no embedded stages array (stages hang off `goalId`,
  §5.3 — correctly), so layout needs the actual scheduling units passed separately.
- `checkpoints: Checkpoint[]` — the deadline-pressure signal (`score.ts`) needs scope
  progress to compare against a target date.
- `now: IsoDateTime` — D34 requires the clock be a parameter; layout needs "today" to
  know which dates in the week are past (rule 3) and can't read it internally.

Same reasoning applies to `pace.ts`'s `scopeStatus`, which also takes a `history:
SessionLog[]` beyond the `(stage, checkpoints, now)` sketch — D17's "sessions per
chapter" measurement needs the session count, which checkpoints alone don't carry.

**Design decisions worth knowing before touching this code:**
- `reconcile.ts`'s knapsack has no separate "value" field to work with (`PlanSlot` only
  carries `minutes`) — it treats the input `slots` array's *order* as priority (index 0
  = most important) and derives knapsack value from rank position. Callers (the future
  check-in feature) must pass slots pre-sorted by priority, most important first — the
  order `layout.ts` itself produces already satisfies this for a freshly-generated plan,
  but a check-in re-score at call time may want to re-sort first since staleness/debt
  shift day to day.
- `layout.ts`'s daypart choice among a stage's *eligible* dayparts (when more than one
  is open) load-balances by least-sessions-placed-today, tie-broken by
  `daypart.sortOrder` — there's no explicit per-daypart session cap in the schema, so
  this is what actually keeps D9 scarcity meaningful (it's what stops a flexible stage
  from crowding out a scarce one's only option).
- `Daypart.activeCap` (D7/D11 — max *active* goals per daypart) is **not enforced by
  layout.ts**. Treated as a goal-activation-time admission constraint owned by the UI
  (D31: promotion is manual), not the scheduler — `layoutWeek`'s `goals`/`stages` inputs
  are assumed already filtered to what's legitimately active.
- Hybrid cadence (`"4×/week, one must be Sunday"`) needed a capacity-reservation trick:
  without it, frequency-style placement earlier in the week can spend the stage's whole
  weekly count before its mandatory weekday ever arrives. `reservedForMandatory()` in
  `layout.ts` holds back exactly enough remaining slots once the mandatory day(s) still
  ahead would otherwise be starved.

Not yet wired to anything — Track B's Dexie/Drizzle layer and the Wave 2 check-in
feature are what will actually call these functions.

### Track B — Data layer (`db/`, `drizzle/`)
*not started*

### Track C — Design system
*not started — `docs/design.md` is written, so this is unblocked*

### Track D — Shell / PWA / push
*not started*

---

## Decisions still open

Tracked in `DECISIONS.md` under "Open questions". Currently outstanding:

- **First-run seeding** — seed sensible default daypart boundaries, or make the user set
  them? *(Leaning: seed defaults; boundaries are editable anyway.)*
- **Display face** — Inter throughout, or a warmer serif for the one big number per
  screen? Not blocking.
- **`auto` theme boundary** — does dark begin at the *night* daypart or at *evening*?
- **Scheduler coefficients** — deliberately unfixed. Tuned once the app is in real daily
  use; they live in `core/constants.ts` so tuning is a one-file change.

## Gotchas worth remembering

- **Vercel Hobby cron is unusable for reminders** — once per day, ±59 min. Verified.
  Scheduling goes through Supabase `pg_cron`. (D37)
- **The plan must sync.** Layout is deterministic but takes `existing` placements as an
  input, so it is path-dependent — two devices legitimately diverge. Synced atomically
  per week. (D45)
- **`core/` purity and the no-fetch-in-UI rule are ESLint-enforced.** A firing guard means
  the design is being violated; fix the code, not the rule. (D42)
- **Amber has two tokens.** `accent-fill` (~2:1) is background-only; `accent-text` is the
  contrast-safe one. Swapping them is the exact legibility bug the predecessor shipped.
  (`design.md` §2.2)
- **No `backdrop-filter` / large blurs.** Main cause of jank on budget Android.
  (`design.md` §6.1)
