# my-time — Memory

Working state across sessions. **Update at the end of every session** — this is the
handoff, and with parallel tracks running it is the only shared view of progress.

**Conflict rule:** append under **your own track heading only**. Do not rewrite other
tracks' sections.

---

## Where things stand

**Phase:** Wave 1 merged into `main` (A scheduler · B data layer · C design
system · D1 PWA shell). `main` is green: lint, 62 tests, and a production build
all pass.
**Live:** https://my-time-nu-brown.vercel.app (auto-deploys from `main`).
All six planning documents are done.

**The daily loop is now usable** (Wave 2b, on `track/wave2b-checkin`, not yet
merged to `main`): check-in, the packed/reasoned session list, one-tap logging,
`/missed`, and the calm on-track summary all work end to end. **Goal creation is
still missing** — Wave 2a (`app/goals/`, `app/settings/`) hasn't landed, so 2b's
verification seeded a goal by hand rather than through the UI.

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

**Wave 2a — Settings + goals** (`app/settings/`, `app/goals/`, `features/goals/`)
is the one piece of Wave 2 still outstanding: daypart boundaries, per-daypart
caps, goal CRUD, cadence, eligibility, time-box, optional scope count, planned
vs active with free-slot counts visible (D31). Until it merges, the only way to
create a goal is by hand through `db/local/mutations.putGoalWithStage` — 2b
verified the check-in loop this way.

Once 2a merges, the supervisor should merge 2b (`track/wave2b-checkin`) too. No
open questions left for the supervisor from 2b — the one flag worth a second look
later is the per-click width of `/missed`'s bounded week-scan
(`WEEKS_PER_MISSED_SCAN = 4`), a judgement call rather than a measured one.

Second-round Wave 1 work is still outstanding: **D2** (push endpoints +
`pg_cron`) — **D3** (sync-status indicator) is done, mounted in Wave 2.0's merge.
Then Wave 3 (sync) and Wave 4 (tracking).

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
**Done, pending two things the user needs to look at (both flagged below).**

Branch `track/db`, worktree `../my-time-db`.

- `src/db/server/schema.ts` — Drizzle schema, **10 tables**: `users`, `dayparts`,
  `goals`, `stages`, `session_logs`, `checkpoints`, `check_ins`,
  `push_subscriptions`, `plan_weeks`, `plan_slots`.
- `src/db/server/client.ts` — postgres.js + Drizzle. `prepare: false` is **required**,
  not tuning: Supabase's transaction-mode pooler can't hold prepared statements.
- `drizzle/0000_initial_schema.sql` + `drizzle/0001_fk_delete_behaviour.sql` —
  generated, committed with `drizzle/meta/` (the journal is what makes the next
  `generate` correct), and **applied to Supabase**. Verified live: 10 tables in
  `public`, 28 indexes, 15 check constraints, 13 FKs with the intended delete rules.
- `tests/db/local-schema.test.ts` — 7 assertions that the Dexie index strings parse
  into the indexes `queries.ts` actually queries. Dexie parses `stores({...})` from
  strings, so a typo there is invisible to `tsc` **and** to ESLint and would fail at
  `open()` on a real device in Wave 2. Needs no IndexedDB and no new dependency —
  Dexie builds its schema at construction. This is the only test in the track; the
  pure core remains the thing worth testing (CLAUDE.md).
- `src/db/local/schema.ts` — Dexie mirror, `version(1)`, + the local-only `outbox`.
- `src/db/local/queries.ts` — bounded read helpers, outbox helpers, atomic
  `replacePlanWeek`, `pruneHistoryBefore`.
- `drizzle.config.ts` — added `process.loadEnvFile(".env.local")`; drizzle-kit isn't
  Next.js and doesn't read `.env.local` on its own. Node 22 built-in, no new dep (D50).
- `npx tsc --noEmit` and `npm run lint` both clean. No new dependencies added.

**Two things needing the user's eye:**

1. **`plan_weeks` is a new table, not in `Architecture.md` §5's list.** D45 requires
   "one version stamp for the whole week". Putting that stamp on each `plan_slots` row
   and extracting it later would move a column between tables — the exact reshape D51
   forbids. So it exists now: `(id, user_id, week_start, version, updated_at)`,
   `unique(user_id, week_start)`, with `plan_slots.plan_week_id` cascading. "Latest
   wins wholesale" becomes: replace the week row, let the cascade take its slots.
   **Proposed as D53 — not written to `DECISIONS.md` unilaterally.**
2. **`goal_cycles` is deliberately absent.** D51 names it as the deferrable case, and
   PRD §6.1 tags verdict cycles `[later]`. It's a new table with an FK to `goals`, so
   it's purely additive whenever it lands. Note this makes `Phases.md` line 64
   ("schema-complete now, including tables v1 leaves nearly empty (D29)") and
   `Architecture.md` §5's "`goal_cycles` — v1 writes, UI deferred" both stale — they
   predate D51.

**For Track A:** `GoalState` in `core/types.ts` is `planned | active | dropped`, but
PRD §6.1 `[v1]` says `planned → active → completed / dropped`. **`completed` is
missing.** The DB check constraint mirrors `types.ts` exactly rather than patching a
frozen file — if A adds it, say so and B regenerates the migration (cheap, DB is empty).

**Deliberate additions beyond §5.1, all reshape-driven:**

- `user_id NOT NULL` on the five top-level tables (`dayparts`, `goals`, `check_ins`,
  `push_subscriptions`, `plan_weeks`). Backfilling it later changes a relationship's
  shape. Child tables (`stages`, `session_logs`, `checkpoints`, `plan_slots`) reach the
  user through their parent and don't carry it.
- `updated_at` on every mutable table — §6 resolves those by LWW *on `updated_at`*, so
  it's load-bearing.
- `server_updated_at` on every synced table — `POST /api/sync { since }` needs a
  server-authored cursor; client timestamps carry device clock skew. Indexed on the
  growing tables.
- `deleted_at` on the mutable tables only. Without a tombstone, sync cannot propagate a
  delete. **Not** on the append-only tables — the past is immutable (D32).
- Enum-ish columns are `text` + a CHECK, not `pgEnum`. Changing a Postgres enum's
  values is the one genuinely annoying migration; text isn't.

**Delete rules — read before adding an FK here.** The app soft-deletes, so these paths
are dormant, which is exactly why they'd surface as a baffling 500 later:

- **The ownership chain cascades the whole way down**: user → goal → stage → session
  logs / checkpoints / plan slots. A cascade that stops halfway (the original 0000 had
  `goals → stages` cascading into a `session_logs` no-action) leaves a hard delete
  failing on an FK violation mid-statement. Fixed in `0001`.
- **References to `dayparts` deliberately do not cascade.** A logged session keeps the
  `daypart_id` it was recorded against (D44), so a daypart with history can only be
  soft-deleted. The restriction is the point, not an oversight. Consequence: a future
  hard "delete my account" will restrict on dayparts and needs to be a scripted,
  ordered delete rather than one statement.
- **`stages.eligible_dayparts` is `uuid[]` and carries no FK** — an array can't. A
  hard-deleted daypart would leave a dangling id. Accepted: it matches the frozen
  `Stage.eligibleDayparts: string[]`, dayparts are soft-deleted, and switching to a
  join table later would itself be the reshape D51 forbids. Readers filter against the
  live daypart set.

**Gotchas:**

- **`.env.local` is gitignored, so it does not exist in a fresh worktree.** Copy it
  from the main checkout before `db:migrate`.
- **The transaction pooler (`:6543`) did handle the DDL** — no need for the
  session-mode string. Recorded because the opposite is the common failure.
- **`db:migrate` prints two `NOTICE`s** — `schema "drizzle" already exists` and
  `relation "__drizzle_migrations" already exists`. Benign; it is idempotent.
- **`0001` exists because dropping the schema was refused, not because a squash was
  wrong.** With an empty DB a single clean `0000` would be tidier, so if Track A's type
  changes force a regeneration anyway, squash both files then — it needs an explicit
  go-ahead for the `drop schema public cascade`.
- **IndexedDB cannot index `null`**, so `deletedAt` is not a Dexie index. Soft-deleted
  rows are filtered in JS, and only on the bounded tables (`dayparts`, `goals`,
  `stages`) — never on a growing one.
- **`sessionLogs` pages on a `[date+id]` keyset, not on `date`.** Paging on `date`
  alone silently drops the rest of a date that straddles a page boundary.
- **`weekStart` is denormalised onto the Dexie `plan_slots` row** even though Postgres
  keeps it only on `plan_weeks`. Intentional — the mirror exists for join-free indexed
  reads. It is not a mistake to "fix".
- **`stages.*eligibleDayparts` is a Dexie multiEntry index.** Scarcity-first layout
  filters stages by eligible daypart (D9), and an array field is otherwise unindexable.
- **Nothing enforces that `db/local` never imports `db/server`** — the two ESLint
  guards only cover `src/core` and `src/app|features`, so a passing `npm run lint`
  proves nothing here. Both sides map to/from `core/types.ts` at their edges by
  convention. Worth a third guard whenever someone is next editing
  `eslint.config.mjs` (left alone here: Track C is adding D52's colour rule to it).
- **`user_id NOT NULL` means a `users` row must exist before any write.** First-run
  seeding is still open (`Architecture.md` §11) and is *not* done in the migration.
  Wave 2a needs to create it.
- **No tests here.** The pure core is what's worth testing (CLAUDE.md), and a Dexie
  schema test would need `fake-indexeddb` — a new dependency, which needs asking (D50).

### Track C — Design system
**Done.** Built in `../my-time-design` on `track/design`.

- **D52 mechanism:** every colour lives in `src/app/theme.css` as two blocks —
  `:root, .theme-light { ... }` and `.theme-dark { ... }` — each just the token
  table from `design.md` §2/§2.3 as hex values, nothing else. Adding a theme means
  adding a third `.theme-<name>` block there; nothing else changes. `src/app/globals.css`
  holds the Tailwind wiring (`@theme inline`) that maps both the app's semantic
  tokens (`bg`, `surface`, `accent-text`, `on-track`, ...) and every shadcn slot
  (`--primary`, `--muted`, `--destructive`, ...) onto those same variables via
  `var()` — every value in that block is a reference, never a literal, so shadcn
  primitives theme themselves with zero per-component work.
- **Lint:** `eslint.config.mjs` gained a `noRawColour` block (same shape as the
  two invariant guards) scanning `src/app/**`, `src/features/**`,
  `src/components/**` for hex literals, `rgb()/hsl()/oklch()/...`, raw Tailwind
  palette utilities (`bg-slate-800`), and raw `bg-black`/`text-white`. Caught two
  real violations in the shadcn-generated `dialog.tsx`/`sheet.tsx` (`bg-black/10`
  scrim) — added a `--scrim` token rather than leaving them as an exception.
- **Theme switching:** mode (`light`/`dark`/`auto`) resolved before first paint by
  an inline `<script>` in `layout.tsx`'s `<head>` (no import — must run with zero
  bundle dependency), applying a `theme-{light,dark}` class to `<html>`.
  `src/lib/theme.ts` holds the same resolution logic for client-side use (via
  `useSyncExternalStore`, not effect+setState — the repo's `react-hooks/set-state-in-effect`
  lint rule rejects the naive version) plus a stub `resolveAutoTheme` that takes an
  optional daypart list and falls back to `prefers-color-scheme` — real daypart
  boundaries aren't wired up yet (Track A/B own that shape); whoever wires them
  just needs to pass a `{ name, startTime, endTime }` array in.
- **Two easy-to-violate rules from `design.md` both caught mid-build:** shadcn's
  generated `dialog.tsx`/`sheet.tsx` used `backdrop-blur-xs` on their overlays —
  removed (no backdrop-filter, D-motion rule). The generated `skeleton.tsx` used
  `animate-pulse`, which is an infinite loop — design.md §6.1 bans that outright
  ("nothing infinite... no looping shimmer, no pulsing dots"); made it a static
  fill instead. Worth re-checking any *future* `npx shadcn add` output against
  both rules before merging — the generator doesn't know about either.
- Installed in one pass (package.json is frozen after Wave 0): input, label,
  textarea, select, checkbox, radio-group, switch, card, dialog, sheet, badge,
  separator, tabs, tooltip, dropdown-menu, sonner, skeleton — alongside the
  existing button. Removed `next-themes`, which the shadcn CLI pulled in as a
  transitive dep of the `sonner` component; rewired `sonner.tsx` to use our own
  `useThemeMode()` hook instead (D50 — didn't ask before it landed, so it came
  back out rather than staying an unapproved dependency).
- Inter via `next/font/google` (self-hosted, no runtime request), tabular
  numerals as a `.numeric` utility class, type scale as named Tailwind font-size
  tokens (`text-display` … `text-caption`) matching `design.md` §4.2 role names
  directly. Spacing needed no override — Tailwind v4's default 4px scale already
  matches §5's steps.
- `/styleguide` (`src/app/styleguide/`) renders every token, the type scale, the
  spacing scale, status colours, and every installed component, with a live
  light/dark/auto toggle at the top. `npm run lint`, `npm run build` both pass;
  checked manually in Chrome in both themes (dialog/sheet/toast/dropdown all
  interactive-tested).
- **Handoff to Track D:** layout.tsx is ready for the service-worker
  registration snippet — Track D should hand it over rather than editing
  `layout.tsx` directly, per the track split.

### Track D — Shell / PWA / push
**D1 done. D2 and D3 not started.**

- `public/manifest.webmanifest` + 192/512 `any` and `maskable` icons.
- `src/sw.ts` — Serwist worker: precaches the build manifest, `skipWaiting`,
  `clientsClaim`, `navigationPreload`, default runtime caching.
- Did not touch `src/app/layout.tsx`, per the track split — the registration
  snippet was wired in during the Wave 1 merge instead (see below).

**Still open on this track:** D2 (VAPID keypair, `POST /api/push/subscribe`,
`GET /api/cron/remind`, Supabase `pg_cron` at daypart boundaries) and D3 (the
sync-status indicator component). Both were always second-round work. Not done
until a real notification lands on an Android phone.

### Wave 1 merge — integration
**Done.** Merged `B → A → C → D1` into `main` with `--no-ff`. Zero file
conflicts: the path-ownership split in `Phases.md` held, `core/types.ts` was
untouched by every track, and `memory.md`'s per-track headings merged cleanly.

Three things the merge had to resolve, because no single track owned them:

- **`@serwist/next` is incompatible with Next.js 16.** Next 16 runs Turbopack by
  default; `@serwist/next` only injects a webpack config, and the build failed
  with *"using Turbopack, with a `webpack` config and no `turbopack` config"*.
  Migrated to **`@serwist/turbopack`** (already installed by Track D1, so no new
  dependency): `withSerwist` in `next.config.ts`, the worker now compiled and
  served by `src/app/serwist/[path]/route.ts` (which sets
  `Service-Worker-Allowed: /`, so scope is still the whole origin), `sw.ts`
  imports `defaultCache` from `@serwist/turbopack/worker`, and `SerwistProvider`
  registers `/serwist/sw.js` from `layout.tsx`. Nothing is emitted into
  `/public` any more, so the `sw.js` gitignore lines are gone.
- **The D1 → C `layout.tsx` handoff never happened** — neither branch had it.
  Added during the merge: `metadata.manifest`, `appleWebApp`, and the
  `SerwistProvider` wrapper.
- **`theme_color` disagreed** — the manifest said `#2F455D` (`ink`), the
  `viewport.themeColor` said `#FAF7F1` (`bg`). Manifest now matches `bg`.

A fourth thing only the deploy caught: `createSerwistRoute` defaults
`useNativeEsbuild` to `false` off Windows, so the first pushed build failed on
Vercel with `Cannot find package 'esbuild-wasm'` while passing locally. Pinned
`useNativeEsbuild: true` and added **`esbuild@0.28.1` as a devDependency** — the
one dependency this merge introduced, and only because `@serwist/turbopack`
declares it as an (optional) peer.

`npm run lint`, `npm run test` (62 tests, 6 files) and `npm run build` all pass
on merged `main`. Build compiles the worker: 24 precache entries.

The four `git worktree`s are left in place for Wave 2.

### Wave 2.0 — Foundation
**Done**, on `track/wave2-foundation`. The shared layer 2a and 2b both build on.
Wave 1 merged four disconnected pieces; this connects them. No feature UI.

**Frozen signatures** — these are contracts other sessions depend on:

```ts
// lib/daypart.ts — pure, `now` always a parameter
localNow(date?: Date): IsoDateTime            // the ONE sanctioned clock read
currentDaypart(dayparts, now): Daypart | null
daypartDate(daypart, now): IsoDate            // the occurrence's date — READ THIS
daypartEndsAt(daypart, now): IsoDateTime
minutesRemainingIn(daypart, now): number      // 0 when `now` is outside it
daypartLengthMinutes(daypart): number
daypartsRemainingToday(dayparts, now): Daypart[]
eligibleDaypartsRemainingToday(dayparts, stage, now): number
minutesOfDay(hhmm) · minutesSinceMidnight(now) · daypartContains(daypart, now)

// db/local/mutations.ts — each one `rw` transaction: row + outbox, never separable
newId(): string
putUser · putDaypart · putGoal · putStage(row, now)
putGoalWithStage(goal, stage, now)            // one save, both rows (PRD §6.3)
logSession(Omit<SessionLog,"id"|"loggedAt">, now)
putCheckpoint · putCheckIn(Omit<…>, now)
dropGoal(goalId, now)                          // state -> "dropped", never deleted (D48)

// db/local/queries.ts — added
getGoalsWithStage({ states? }) · getDaypartCapacity() · getPlanWeek(weekStart)
getRecentCheckpointsForStages(stageIds, { limitPerStage })

// features/plan/planner.ts — the only core/ ⇄ Dexie bridge
relayoutWeek({ now, weekStart? }): { weekStart, version, slots }
reconcileNow({ now, daypartId, availableMinutes }): { keep, dropped }  // ReconciledSlot[]

// db/local/seed.ts
seedIfEmpty(now): Promise<boolean>            // LOCAL_USER_ID, DEFAULT_DAYPARTS
```

**The `IsoDateTime` convention — the thing most likely to be got wrong.**
`IsoDateTime` is **local wall-clock**: `YYYY-MM-DDTHH:mm:ss`, no `Z`, no offset.
Forced, not chosen: `Daypart.startTime`/`endTime` are wall-clock `"HH:mm"` and
`dateUtils.dateOnly()` is `slice(0,10)`, so both only agree if the timestamp is
local. `new Date().toISOString()` would put every user east of UTC in the wrong
daypart and record sessions against the wrong `date` after ~18:30 local — and
silently, since tests pass strings in directly. **Always `localNow()`.**

**The night daypart's date anchor — the second thing 2b must not get wrong.**
`layoutWeek` anchors a slot to the day its loop was on, so "Thursday night" is
`{ date: "2026-07-30", daypartId: "night" }`. At 02:00 on the 31st the user is
still inside that occurrence, but `dateOnly(now)` has already rolled over. Keying
off it means checking in at 2am shows an **empty plan** — caught here by an
end-to-end run, not by the unit tests, because the wrap is handled correctly
*inside* `daypart.ts` and was being lost *at the seam*.

So `daypartDate(daypart, now)` returns the occurrence's own date, and **every read
or write keyed by `(date, daypartId)` must use it instead of `dateOnly(now)`**:

- `reconcileNow` does (fixed).
- **2b must use it for `logSession({ date })` and `putCheckIn({ date })`** —
  otherwise a session done at 01:00 records against the wrong calendar day, and a
  Sunday-night session lands in the wrong `weekStart` for cadence counting.

`reconcileNow`'s cadence window (`weekStart`/`weekEnd`, and the `today` it scores
with) follows the anchor date too, so the ordinal in "2nd of 3 sessions" counts
against the week the slot actually belongs to.

**Decisions owned here** (both documented in `planner.ts`):

- **The plan's outbox row covers the whole week.** One row on `planWeeks`, payload
  `{ week, slots }`. Never per-slot — that would let two devices interleave halves
  of two plans (D45). Wave 3 must push and apply it as one unit.
- **`LocalPlanWeek.version` is monotonic per `weekStart`**, from 1, incremented on
  every local relayout. The version read, the replace and the enqueue share one
  transaction, so two concurrent relayouts can't mint the same number. Across
  devices it is deliberately *not* unique — the week resolves LWW wholesale on
  `updatedAt`, with `version` as tie-break and lineage signal.

**First-run seeding — resolved.** Seed defaults (the leaning in "Decisions still
open" was right). `seedIfEmpty` writes the user row plus morning 05:00–12:00,
afternoon 12:00–17:00, evening 17:00–21:00, night 21:00–05:00, `activeCap: 2`,
through `putDaypart` so they queue for sync. Idempotent, and the emptiness check
shares the transaction so concurrent calls can't double-seed. It is fired from
`components/nav.tsx`'s mount effect — `layout.tsx` is a server component and Dexie
is browser-only, and nav is the only client component on every route. Move it if a
later wave adds a real client boot module.

**Two `core/` findings. `src/core/**` was not edited** (frozen for this wave):

1. **`layoutWeek` can emit two byte-identical slots** for one stage on one date —
   a retained `existing` slot plus a freshly placed one. Slot ids are
   `plan-<stageId>-<date>` with no daypart or occurrence component, so `bulkPut`
   collapses them and the week comes up a session short with no error anywhere.
   Reproduced: one stage, `cadenceCount: 2`, `minRestDays: null`, one existing
   future slot → two identical slots returned. Reachable whenever cadence is
   raised after a layout. `planner.dedupeById` contains it explicitly; the id
   scheme is the supervisor's call.
2. **`reconcile.ts`'s doc comment is wrong.** It says slots arrive "in priority
   order — the order layout.ts produces", but `layoutWeek` sorts date → daypart →
   `stageId` alphabetically, and `getPlanSlotsForDaypart` returns index order
   regardless. `planner.reconcileNow` imposes real priority by re-scoring with the
   same `scoreStage`. Nothing is broken; the comment is misleading.

**No `core/types.ts` gaps.** One trap worth knowing though: `StageState` has no
`"dropped"` member, so `dropGoal` leaves the goal's stages `active`. Every read
that counts active stages must join goal state — `getDaypartCapacity` and
`relayoutWeek` both do. A read that doesn't will keep reserving capacity for
dropped goals.

**Verified**: `lint` + `test` (89 tests, 7 files) + `build` all pass. The Dexie
layer was additionally exercised against `fake-indexeddb` (installed `--no-save`,
**not** added to `package.json`) — transaction nesting, version monotonicity, one
`planWeek` row, one outbox row per week, `reconcileNow` writing nothing, capacity
joining goal state, and the night slot resolving to the same id either side of
midnight. **That harness is what caught the anchor bug, and it is not in the
repo** — making it permanent needs `fake-indexeddb` as a devDependency, which is
the supervisor's call (D50). Worth doing: unit tests over `daypart.ts` alone
cannot see a seam bug. In-browser: first-run seeding
produced 4 dayparts + 1 user + 5 queued outbox rows, idempotent across reloads, no
console errors; nav is 44px targets, `sticky` top from `md`, `fixed` bottom below
it with 80px content clearance.

**Left for the supervisor:** mount Wave 2d's `<SyncStatus />` at the marked seam in
`components/nav.tsx`.

### Wave 2.0 merge — supervisor resolutions

Merged with `--no-ff`, no conflicts. Both reported `core/` findings were real and are
now fixed on `main`; `src/core/**` stays frozen for feature tracks — these were
supervisor changes, with tests, as `CLAUDE.md` requires for any `layout`/`reconcile`
change.

1. **Duplicate slot ids — confirmed and fixed (now D54).** `respectsRest` returns true
   unconditionally when `minRestDays` is null, which is the common case, so a retained
   slot did not stop a fresh placement on the same date. `placeRemaining` now filters
   `!committedDates.includes(day)`. Two regression tests added under *"layoutWeek — one
   session per stage per date"*; **verified they fail without the fix** — the realistic
   three-goal case returned 14 slots with only 12 unique ids. `planner.dedupeById` was
   removed, since keeping a containment for a fixed bug is how the next regression hides.
2. **`reconcile.ts`'s doc comment — corrected.** It claimed slots arrive in priority
   order "the order layout.ts produces"; they don't. The comment now states that the
   caller must impose the order and that `planner.reconcileNow` re-scoring is the correct
   behaviour, because priority depends on the day it's asked on, not on when the plan was
   laid out.
3. **The local wall-clock convention is now D53.** Too important to live only in a
   handoff note — `new Date().toISOString()` is a bug anywhere in this codebase, and
   `localNow()` is the single sanctioned clock read. The timezone-ambiguity cost is
   recorded there honestly.
4. **`fake-indexeddb` — approved and now permanent (D55).** `tests/features/planner.test.ts`
   runs the real Dexie schema against it, 11 tests over the properties that only exist at
   the seam. **It found a real bug on its first run**, which completed the D54 fix: the
   one-session-per-date rule was enforced in `placeRemaining` but *not* in
   `retainValidExisting`, so a slot on a date whose session had since been logged was
   retained. Consequences were (a) the day you just finished kept showing an outstanding
   session and (b) `layoutWeek` returned different output for identical inputs depending
   on whether a prior plan was passed as `existing` — an `Architecture.md` §4.2 rule 2
   violation. Proven by running fresh vs fed-back side by side, then fixed and covered by
   two more `core` tests. Suite is now **104 tests**.

**`docs/Phases.md` corrected.** Wave 2 said "sequential-ish; two sessions at most"; it is
2.0 plus four. The revision also records why the estimate was wrong (the shared layer was
invisible until the Wave 1 tracks were in one tree), what Wave 1 actually cost at the
seams, and the rule that cross-track mounts belong to the supervisor, never to a track.

**Process note:** Wave 2d committed its two code files correctly on its own branch but
wrote its `docs/memory.md` notes into the *main* worktree instead, where they sat
uncommitted and blocked this merge. Preserved verbatim and reapplied when 2d merged.
Sessions should write only inside their own worktree — the same class of mistake as
Wave 0's `git add -A`.
### Wave 2b — Check-in + logging
**Done.** Built in `../my-time-checkin` on `track/wave2b-checkin`. This is the daily
loop — the first genuinely usable moment (PRD §6.5–§6.7, Architecture.md §9.2).

- `src/app/page.tsx` — replaced the placeholder with `<CheckinView />`.
- `src/app/missed/page.tsx` — new, killed sessions surfaced calmly (D20).
- `src/features/checkin/` — new: `checkin-view.tsx` (orchestrator),
  `session-card.tsx`, `goal-status-row.tsx`, `checkpoint-prompt.tsx`, `lib.ts`
  (view-layer helpers: `requiredMinutesForDaypart`, `goalPaceStatus`,
  `cadenceLevel`, `voluntaryCandidates`, `missedForWeek`/`missedOccurrencesPage`,
  formatting, `shouldPromptCheckpoint`).

**Nothing in `core/`, `db/local/`, or `features/plan/` needed to change.** Every
query/mutation the loop needed already existed — `getGoalsWithStage`,
`getDayparts`, `getLatestCheckpoint`, `getPlanSlotsForWeek`,
`getSessionLogsBetween`, `logSession`, `putCheckIn`, `putCheckpoint`,
`reconcileNow`, `relayoutWeek`. No gaps to report.

**Flow, matching Architecture.md §9.2 exactly:**
`currentDaypart` detects (user overrides via a `Select`, never forced) → the D8
numbers (`requiredMinutesForDaypart`, `daypartLengthMinutes`, `minutesRemainingIn`,
`daypartEndsAt`) render before any input → user states available minutes →
`reconcileNow` packs and enriches → one tap per `SessionCard` calls `logSession`
then `relayoutWeek` → the card's slot drops out of `keep` on the next
`reconcileNow` (live via `useLiveQuery`, not a manual refetch). Dropped slots
render read-only under "Won't fit today" — no buttons, since D27 forbids partial
sessions. **Voluntary catch-up** (Architecture.md §9.3, D20) is a separate
always-visible "Log a session" section below: any active stage not already
logged today and not already offered above, gated by `maxPerWeek`/`minRestDays`
where the stage sets them, logs with `source: "voluntary"`.

**Decisions made at this layer, none touching `core/`:**
- **Detected daypart is a plain derived expression, not stored state**, with a
  separate `daypartOverride` set only once the user actually picks one. Storing
  the detection in `useState` and syncing it via an effect trips the repo's
  `react-hooks/set-state-in-effect` lint rule (same one Track C hit in
  `lib/theme.ts`) — derive, don't sync.
- **Reads use a mount-time `initialNow`; every write re-reads `localNow()`
  fresh at the moment of the action.** The detected-daypart default and the
  pre-check-in stat row are read-only and reviewed/corrected by the user anyway
  (PRD §6.5), so staleness there is harmless. But `putCheckIn`, `logSession` and
  `putCheckpoint` each call `localNow()` at click-time rather than reusing a
  value frozen at mount — a backgrounded PWA tab reopened hours later must not
  write a session against the daypart/date it detected when it first loaded.
  Caught in review before merge, not by the user's manual walkthrough (which
  didn't background the tab), so it's recorded here explicitly as the fix
  rather than left implicit in a diff.
- **Checkpoint prompt cadence (`shouldPromptCheckpoint`) is a local `lib.ts`
  constant (7 days), not a `core/constants.ts` coefficient** — it is a UI-timing
  choice ("occasionally", PRD §6.6/D13), not a scheduling input the scorer reads,
  so it doesn't belong in the scheduler's single tunable-coefficients file.
- **`/missed` shows both explicit skips and unlogged-past-due sessions.**
  Architecture.md §9.3 defines missed as "an unlogged session past its daypart" —
  the primary case is the user never opening the app for it at all, which can't
  be read off `sessionLogs` alone. `missedForWeek` diffs a week's
  `getPlanSlotsForWeek` against `getSessionLogsBetween`, keeping only slots whose
  occurrence has actually ended (`daypartEndsAt` anchored at the slot's own start,
  not "now" — the same D53 wrap-safety trick, reused rather than re-derived) and
  no log exists for that `(stageId, date)` yet, then unions in explicit
  `status: "skipped"` logs. **Load-bearing fact this relies on, checked against
  `core/layout.ts` before shipping:** `layoutWeek` passes past-dated slots
  (`pastSlots`, line 67/82) through **unconditionally**, regardless of whether
  they've since been logged, and `relayoutWeek` never re-touches a week once it's
  no longer the current week. So a past unlogged slot really does survive every
  relayout — this is what makes reading `planSlots` a valid missed-detection
  source rather than one that quietly loses its own evidence.
- **`/missed` pagination scans weeks, not log pages.** Scans backward via
  `missedOccurrencesPage`, bounded to `WEEKS_PER_MISSED_SCAN = 4` weeks per "Load
  more" click and to the local retention window (`LOCAL_HISTORY_WINDOW_DAYS`,
  D48) overall — bounded rather than unbounded (D47), but the per-click width is
  a judgement call, not a measured one.

**Verified:** `npm run lint`, `npm run test` (104 tests, unchanged — UI needs no
tests per `CLAUDE.md`), `npm run build` all pass. Full loop tested in-browser
manually (the Claude-in-Chrome extension would not bridge in this session despite
a working install, matching account, and a Chrome restart — root cause not found;
worth a look if it recurs): seeded a `Gym` goal by hand (30 min, night-only,
`cadenceCount: 7`, scope `scopeUnitTotal: 10` "chapter", `targetDate` two months
out), checked in on Night with 60 minutes, saw the packed session with its D14
reason, tapped Done, watched it clear from the list via the live `reconcileNow`
query, and got the coarse checkpoint prompt immediately after (since the seeded
stage had a scope unit) — confirmed working end to end by the user. Also
confirmed the "won't fit" path: checking in with fewer minutes than the box size
correctly drops the session into "Won't fit today" with no buttons, and confirmed
`cadenceStatus.feasible: false` ("Not reachable this week") renders correctly for
a demo stage whose weekly count couldn't fit in the days left in the window —
that's the scheduler being honest given the seed data, not a bug.

A self-review pass after that manual walkthrough (the happy path doesn't exercise
every branch) caught and fixed four issues before this entry was written: tapping
"Skipped" was wrongly shrinking the remaining-time budget (fixed to decrement
only on `done`); voluntary catch-up was entirely unimplemented despite `/missed`'s
own copy advertising it (now built, see above); `scopeStatus.requiredPerUnit` was
gated behind the same `projection != null` check as the measured projection, when
D25 says the *required* line is pure arithmetic and ships from day one — only the
*projection* waits on measured data (now rendered unconditionally in
`GoalStatusRow` whenever non-null); and `/missed` originally read `status:
"skipped"` only, missing the primary "never opened the app" case entirely (now
fixed, see above).

### Wave 2d — Sync status (D3)
**Done.** Built in `../my-time-sync` on `track/wave2d-sync`, two files, nothing else
touched.

- `src/hooks/use-sync-status.ts` — derives `offline` > `pending` > `synced` from
  network state and outbox depth. `syncing` exists in the type but is unreachable
  until Wave 3 wires it.
- `src/components/sync-status.tsx` — icon plus count (pending only). `synced`
  checkmark in `on-track`, `offline` in `neutral`, `pending` dot in `attention`.
  Tabular numerals on the count (`design.md` §4.1). No button, no action (D46).

**Three supervisor corrections at merge**, all in the two files 2d owned:

1. **`animate-spin` removed from the `syncing` icon.** `design.md` §6.1 forbids
   anything infinite outright — *"no looping shimmer, no pulsing dots"* — and a
   spinner on a status that must never pull attention (D46) is exactly what that
   rule exists for. The icon is now still.
2. **Offline-at-load bug.** The hook seeded `isOnline: true` and only updated on
   `online`/`offline` events. A page loaded while *already* offline fires no event,
   so it reported "synced" until the network happened to change — wrong in the one
   case that matters most, since offline is the default path (D33). Now read live
   via `useSyncExternalStore`, matching the `matchMedia` pattern in `lib/theme.ts`.
3. **2-second `setInterval` replaced with `useLiveQuery`.** A poll waking every 2s
   on every route, forever, on a budget Android phone, for a value that only changes
   when something is written. `dexie-react-hooks` was already installed since Wave 0,
   so this is reactive with no new dependency (D47).

**Mounted by the supervisor** at the seam in `components/nav.tsx` — outside the `<ul>`
of links, so it never reads as another destination (D46).

**Seam for Wave 3:** inject the real `syncing` state and a `lastPullAt` timestamp.
The hook's return shape is stable; extend it rather than replacing it.

### Wave 2a — Settings + goals
**Done.** Built in `../my-time-goals` on `track/wave2a-goals`.

- `src/app/settings/page.tsx` + `src/features/settings/daypart-settings.tsx` —
  per-daypart name/start/end/active-cap editor, one row per daypart, each with its
  own dirty-tracking Save button. Saving calls `mutations.putDaypart` then
  `planner.relayoutWeek` (a moved boundary can strand slots placed under the old
  one). Theme toggle (already built by Track C) sits above it on the same page.
- `src/features/goals/goal-form.tsx` — shared create/edit form for the goal +
  its one implicit stage (PRD §6.3), saved together via `mutations.putGoalWithStage`.
  Covers tier, state (planned/active — `dropped` is a separate destructive action,
  never a select option), session length, all three cadence types (D26),
  eligible-dayparts-as-a-set (D7), optional weekly max / rest gap (D20), and
  optional scope (unit label/total/target date, D28). Submitting re-lays-out the
  week. No blank form (O3): every field defaults sensibly (tier normal, 30 min,
  3×/week frequency, every current daypart eligible) except name/purpose, which is
  the one thing only the user can supply.
- `src/features/goals/goals-list.tsx` — active/planned goals ordered by tier, with
  **always-visible** per-daypart capacity (`"evening: 2 of 3 slots used"`, D31) —
  reports the fact, never prompts to fill it (D21). Promotion planned→active is
  the same edit form, manual (D31), not a separate button.
- `src/app/goals/page.tsx`, `.../new/page.tsx`, `.../[id]/page.tsx` (Next 16 async
  `params`) — thin pages over the two feature components above.
- **Daypart-driven `auto` theme wired**, resolving the open question in
  `lib/theme.ts`'s stub: `hooks/use-theme.ts` now reads dayparts live via
  `useLiveQuery(getDayparts)` and passes them into `resolveTheme`, so `auto`
  follows the user's own night daypart boundary instead of the OS preference
  (design.md §3). Re-applies the resolved theme in an effect once dayparts load,
  since the inline pre-paint script in `layout.tsx` can only guess from
  `prefers-color-scheme` before Dexie is ready.

**No new queries or mutations needed** — everything went through what Wave 2.0
already exposed. One thing worth flagging for whoever next touches
`db/local/queries.ts`: there is no single-goal read, so `features/goals/goal-edit.tsx`
loads via the existing `getGoalsWithStage()` (no `states` filter) and finds the one
row client-side. Fine at today's scale (one user, few dozen goals ever), but if that
table stops being "bounded enough for a full read" this is the caller to revisit.

**One lint-driven design choice worth keeping in mind:** the create form's
eligible-dayparts checkbox set can't default to "everything" via a `useEffect`
that calls `setState` once dayparts load — the repo's `react-hooks/set-state-in-effect`
rule (same one Track C hit) rejects that. Instead `eligibleDaypartsTouched` starts
`null` ("not yet touched") and the rendered value falls back to
`dayparts.map(d => d.id)` until the user actually toggles one — no effect needed.

**Verified:** `npm run lint`, `npm run test` (still the 104 tests from Wave 2.0 —
UI needs none, CLAUDE.md), and `npm run build` all pass clean. `/`, `/settings`,
`/goals`, `/goals/new` all return 200 and their server-rendered HTML contains the
expected fields (checked via `curl`, since **the Chrome browser extension was not
connected in this session** — no live click-through, theme-toggle, or form-submit
verification happened. Whoever picks this up next should do that pass in an actual
browser before calling the golden path confirmed.)

---

### Wave 2a + 2b merge — supervisor resolutions

Both merged with `--no-ff`, **zero conflicts** — paths were fully disjoint. `main` is
green: lint, 111 tests, build, and all seven routes live.

Three changes from manual testing, applied on `main` rather than sent back:

1. **One duration format everywhere (`lib/duration.ts`, `design.md` §4.1.1).** Under
   an hour reads in minutes, an hour or more in hours — `45m`, `1h 30m`, `2h` (never
   `2h 0m`). Replaced five inlined `{minutes}m` sites across check-in, the session
   card, `/missed` and the goals list. 7 unit tests. **Never inline `{minutes}m` in a
   component again** — import `formatDuration`.
2. **The daypart is stated, not asked.** Detection already worked
   (`currentDaypart(dayparts, initialNow)`), but it was presented as a required
   `<Select>`, which made every check-in a correction. Now: *"It's Evening"*, with a
   quiet **Change** button that reveals the picker. PRD §6.5's "confirms or corrects"
   is satisfied by the statement — a wrong daypart is visible at a glance.
3. **The checkpoint prompt is gated on scope, not on a label (D56).** Reported from
   testing: *"which chapter are you on?"* appeared on a **gym** goal. The gate was
   `stage.scopeUnitLabel` alone, but `pace.scopeStatus` returns all-null unless
   `scopeUnitTotal` **and** `targetDate` are both set — so a labelled-but-unscoped goal
   was asked a question whose answer nothing could consume. Gate and consumer now share
   one condition.

**On the underlying worry** — *"how would you ask about a non-GATE goal with stages?"*
The unit label is user-defined and the question is generated from it, so a training
block asks *"which week are you on?"* The absurdity was only ever asking a goal with
**no** scope; a cadence-only gym goal is now never asked anything. Multi-stage goals
remain `[later]` (D23) — this changed nothing there.

---

### Wave 2c — Push (D2)
**Done, pending a real Android verification.** Built on `track/wave2c-push` in the
`my-time-shell` worktree, branched fresh from `origin/main` (which already had
Wave 2.0's foundation merged in).

- `POST /api/push/subscribe` — persists `{ endpoint, keys, deviceLabel? }`,
  upserting on `endpoint` (idempotent). No auth/user system exists yet, so it
  resolves-or-creates the single `users` row itself (`users` is "one row in v1"
  per Architecture.md §5) rather than depending on the `/api/sync` endpoint,
  which hasn't been built by any track yet.
- `GET /api/cron/remind` — guarded by `Authorization: Bearer <CRON_SECRET>`,
  401s without it. Sends the fixed content-free payload (`"Time to check in"`,
  empty body — D37b) to every non-deleted subscription via `web-push`. On a
  404/410 response it **soft-deletes** that subscription (`deletedAt`), never
  hard-deletes, matching the tombstone pattern the rest of the schema uses.
- `src/lib/push.ts` — client helper: `isPushSupported`, `requestPushPermission`,
  `subscribeToPush`. Calls `fetch` directly since it's `lib/`, not a component
  (D33 only restricts `app/`/`features/`). **Not wired into any screen** —
  that's a UI track's job; the settings screen (Wave 2a) is the natural place
  to add a "enable notifications" toggle calling `subscribeToPush`.
- `src/sw.ts` — added `push` and `notificationclick` listeners only, left the
  Serwist setup untouched. `notificationclick` focuses an existing client or
  opens `/`.
- `.env.example` — added `VAPID_SUBJECT` (the contact identity Web Push
  requires alongside the keypair; wasn't in the original file) and a
  generation hint (`npx web-push generate-vapid-keys`).
- `drizzle/manual-pg-cron-remind.sql` — **not** a drizzle-kit migration
  (deliberately outside the numbered sequence so `db:migrate` never touches
  it). Four `cron.schedule` calls via `pg_net`, at 05:00/12:00/17:00/21:00 UTC
  matching the default daypart seed — apply by hand in the Supabase SQL
  editor after enabling the `pg_cron` and `pg_net` extensions. Needs
  `pg_cron`/`pg_net` enabled and the URL/secret placeholders filled in.

**What the user still needs to do to actually verify D2:**
1. Run `npx web-push generate-vapid-keys` and set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET` in both `.env.local` and
   Vercel's env vars (all environments).
2. Deploy, then enable `pg_cron`/`pg_net` in the Supabase dashboard and run
   `drizzle/manual-pg-cron-remind.sql` with the real deployment URL and
   `CRON_SECRET` substituted in.
3. Wire `subscribeToPush()` into a real screen (settings is the obvious spot)
   so a subscription actually gets created.
4. Install the PWA on an Android phone, grant notification permission, and
   confirm a nudge arrives at a daypart boundary — **this is the only thing
   that proves D2 is actually done**, per the track brief.

Verified locally: `npm run lint`, `npm run test` (62 tests), `npm run build`
all pass. Manually hit both endpoints against the real Supabase dev database —
`subscribe` upserts correctly (verified twice with the same endpoint, then
deleted the test row), `remind` 401s without the secret and 200s with it. Did
not send a real push message end-to-end (no subscribed device yet).

---

### Wave 2c merge — push is wired, but not yet verified on a phone

Merged clean. Endpoints, worker handlers, `lib/push.ts` and the `pg_cron` SQL are all
on `main`; `/api/push/subscribe` and `/api/cron/remind` build as server routes.

**The gap the supervisor closed:** nothing called `lib/push.ts`. A browser only
prompts for notification permission in response to a user gesture, so push had no
entry point at all — the same cross-track shape as the D1 → C `layout.tsx` handoff,
and closed the same way (`Phases.md`, "the handoff that must not be assigned"). Added
`features/settings/notification-settings.tsx` and a **Reminders** section in settings.
Permission is read via `useSyncExternalStore`, matching `lib/theme.ts` and
`use-sync-status.ts` — the first draft used effect+setState and the lint rule
`react-hooks/set-state-in-effect` correctly rejected it.

**Wave 2 is now fully merged. D2 is NOT done.** Three manual steps remain, all
requiring credentials this session must not create:

1. Generate a VAPID keypair — `npx web-push generate-vapid-keys`.
2. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   (`mailto:...`) and `CRON_SECRET` locally **and in Vercel**, then redeploy — the
   public key is inlined at build time, so a redeploy is required, not just a restart.
3. Apply `drizzle/manual-pg-cron-remind.sql` in Supabase and set the schedule to the
   daypart boundaries.

Until then the Reminders button will fail gracefully and say so. **Track D is not done
until a notification actually arrives on the Android phone** (D36) — that is a manual
verification only the user can perform.

---

### Wave 3 / Wave 4 readiness — supervisor assessment

**Wave 3 (sync) has one hard blocker. Fix it before a session starts, not during.**

Every `id` column in `src/db/server/schema.ts` is Postgres `uuid`, but four kinds of
row are created locally with **deterministic non-UUID ids**:

| Row | Local id | Why it is deliberate |
|---|---|---|
| user | `local-user` | single-user v1; a UUID per device would fork the row |
| dayparts | `daypart-morning` … | two fresh devices seeding UUIDs then syncing = **8 dayparts** |
| plan weeks | `week-2026-07-27` | D45 needs both devices to name the same week the same row |
| plan slots | `plan-<stageId>-<date>` | **D54 is enforced by this id shape** |

Goals, stages, session logs, checkpoints and check-ins use `newId()`
(`crypto.randomUUID()`) and are fine.

So the very first outbox flush would fail on a Postgres type error for exactly the
tables the plan lives in. **The fix is to widen those server columns to `text`, not to
make the ids UUIDs** — the determinism is load-bearing in all four cases, and D54's
one-session-per-date rule is literally expressed as an id collision. That is one
Drizzle migration (`users`, `dayparts`, `plan_weeks`, `plan_slots` and the FKs that
reference them), reviewed and committed per D29.

Everything else Wave 3 needs is in place: `outbox` with FIFO `seq` and `attempts`,
`SYNCED_TABLES`, `updatedAt`/`deletedAt` on every mutable table, append-only tables
carrying their own `loggedAt`/`checkedInAt`, `planWeeks.version` with documented
semantics, and `use-sync-status.ts` with a marked seam for the real `syncing` state.

**Wave 4 (tracking) is mostly already built** — 2b absorbed it. `core/pace.ts` is
complete and `features/checkin/goal-status-row.tsx` already renders cadence
required-vs-actual, the arithmetic scope line, and the projection as a **range**
(D25). What is genuinely left is small: a per-goal history view, and the
`/goals/[id]` detail page carrying the same numbers.

**One scope question for Wave 4, not a bug.** PRD §6.7 tags measured-pace projection
`[later]`, needing "~2 weeks of data", but `scopeStatus` emits a projection as soon as
**one** checkpoint exists — `measuredPerUnit = doneSessions / latestValue`. The
uncertainty band widens as checkpoints are few (`base / checkpointCount`), so it is
not a confident point estimate and does not violate D25. But "one checkpoint" is a
thin basis for a date. Either gate it on a minimum checkpoint count or accept the wide
band as sufficient honesty — worth deciding deliberately rather than by default.

---

### Pre-Wave-3 — id migration, and housekeeping

**Migration `0002_deterministic_ids_to_text` applied to Supabase and verified.** The
four deterministic-id columns, every FK referencing them, and `stages.eligible_dayparts`
are now `text` (D58). New `src/db/ids.ts` holds `LOCAL_USER_ID` and documents the whole
scheme; `db/local/seed.ts` re-exports it, and `api/push/subscribe` now upserts that id
instead of relying on `defaultRandom()` — which `text` has no equivalent of, and which
`tsc` caught immediately.

**The generated migration did not work and the failure was silent.** `drizzle-kit
migrate` printed a spinner and exited 0 while `__drizzle_migrations` still showed two
rows. The real error only surfaced by running a statement by hand:

```
foreign key constraint "check_ins_daypart_id_dayparts_id_fk" cannot be implemented
DETAIL: Key columns "daypart_id" and "id" are of incompatible types: uuid and text.
```

`drizzle-kit` emits per-column `ALTER`s, and Postgres rejects the moment an FK pair
straddles the change. `0002` is **hand-edited** to drop the nine FKs, convert every
column, then recreate them with their original `ON DELETE` behaviour, plus a `USING`
clause for `uuid[] → text[]` (which has no assignment cast). It says so at the top.
**Regenerating it blindly reintroduces the failure.**

Verified by round-tripping the real ids through Postgres: `local-user`,
`daypart-night`, `week-2026-07-27`, `plan-<uuid>-2026-07-30`, and
`eligible_dayparts = ['daypart-night','daypart-morning']` all insert and read back.
Test rows deleted; all tables are empty again.

**Two things worth knowing that this turned up:**

- `npm run db:migrate` **can report success while doing nothing.** Check
  `drizzle.__drizzle_migrations` after any migration that alters existing columns.
- Hard-deleting a `users` row fails: it cascades to `dayparts`, but `plan_slots`
  references dayparts with `ON DELETE NO ACTION` by design (D44 — a slot keeps the
  daypart it was recorded against). Dayparts are soft-deleted, so this is only
  reachable from a manual `DELETE`, not from the app.

**Projection decision (D57).** The measured-pace projection keeps shipping from the
first checkpoint. It is already a range, and the band widens when checkpoints are few —
showing a wide window is more honest than showing nothing for two weeks. PRD §6.7
retagged `[v1]`. The failure mode to watch is a *narrow* band on thin data; that would
be a real D25 violation and means the coefficients are wrong.

**Housekeeping.** All seven worktrees removed — every branch is merged. `Phases.md` now
requires **one worktree per track at a fresh path, never reuse**, with the removal
command, because a directory checked out to someone else's branch is indistinguishable
from a live one and a session is right to refuse it.

### Wave 3 — Sync

Branch `track/wave3-sync`. `lint` clean, **164 tests** (36 new), `build` green with
`/api/sync` registered. Not merged to `main`.

**Shipped.** `src/sync/{protocol,merge,memo,transport,push,pull,engine,index}.ts`,
`src/app/api/sync/route.ts`, `tests/sync/{merge,push,pull,engine}.test.ts`, and
`use-sync-status.ts` extended (not rewritten) with a real `syncing` state and
`lastPullAt`.

**`sync/merge.ts` is imported by both sides.** The route handler calls the same
`shouldApplyWeek` the client's pull calls. The point is not tidiness: if the two halves
each carried their own copy of "does the incoming row win?", the symptom of drift would
be two devices that quietly never converge, with nothing to see in a log. It is pure —
no Dexie, no Drizzle, no clock — so importing it server-side costs nothing.

**The merge rules, as implemented.**

| Class | Tables | Rule |
|---|---|---|
| append-only | `sessionLogs`, `checkpoints`, `checkIns` | union — insert if absent, **never** overwrite (D32) |
| mutable | `users`, `dayparts`, `goals`, `stages`, `pushSubscriptions` | LWW on `updatedAt`, string compare (D53) |
| the plan | `planWeeks` + its slots | LWW **wholesale per week** (D45) |

Server-side LWW is a `setWhere` on the `ON CONFLICT DO UPDATE`, not read-compare-write:
one statement, no race, and a losing row is not written at all — so it does not bump its
own `server_updated_at` and re-broadcast itself to every device.

**Timestamps on the wire.** `IsoDateTime` is naive local wall-clock; the columns are
`timestamptz`. Those round-trip only if the naive string is stored *as though it were
UTC* — `new Date(s + "Z")` in, `.toISOString().slice(0, 19)` out. The byte the client
sent is the byte it gets back, and Postgres's `<` agrees with the client's string `<`.
Do not "fix" this to the server's local zone.

**Two termination rules, both easy to get wrong into an infinite loop.** Push stops when
a round acks *nothing* — not when the outbox empties, because a permanently refused head
would be re-peeked forever. Pull stops on the server's `hasMore` — not on "rows
arrived", because the cursor is deliberately rewound one second per page (`server_updated_at`
is stamped at statement build, not at commit, so two writes can commit out of order and
a strict cursor would step over one permanently). Plus a 20-round hard cap.

**D45 was underspecified in one place, and it is reachable.** `updatedAt` then `version`
as tie-break is what `planner.ts` fixes — but both can tie for real: two devices opening
the app in the same second and relaying out the same week both produce version N+1 with
the same stamp. "Keep local" there is not convergent — A keeps A's week, B keeps B's,
permanently and silently. Added a third key, deterministic and computed identically on
both sides: the week's slot ids sorted and joined, lexicographically greater wins. Full
week, still wholesale. **Not a contradiction of D45 — it completes it**, and D45's own
"if two devices both re-lay-out, one loses entirely" is what it makes true.

The same tie on a plain mutable row is left unsolved on purpose: server keeps stored,
client keeps local, next edit on either device resolves it. Two goal edits inside one
wall-clock second on two offline devices is not worth a lineage key (D35).

**Where sync runs.** `startSync()` is called from `useSyncStatus` — the indicator is
mounted for the whole session by definition (D46), so "the hook mounted" and "the app
started" are the same event. Triggers: app start, `online`, `visibilitychange`, and a
debounced `liveQuery` on outbox depth after a write. `syncNow` is deliberately **not**
exported from `src/sync/index.ts`: there is no sync button, and the cheapest way to keep
it that way is for the entry point not to offer one.

**Known gaps, all reported rather than patched:**

- **Cursors live in `localStorage`, not Dexie.** The natural home is a local-only table
  beside `outbox`, which needs a `db/local/schema.ts` version bump that was out of
  track. Cost: clearing site data resets cursors without clearing Dexie, so the next
  sync re-pulls the history window and re-applies it — idempotent, but not free. That is
  why the request carries a `historyFloor` (`LOCAL_HISTORY_WINDOW_DAYS`, so the two
  numbers cannot disagree) capping `sessionLogs` and `checkIns`; `checkpoints` is not
  floored because `pruneHistoryBefore` never touches it.
- **No `bumpOutboxAttempts` in `db/local/queries.ts`.** `OutboxRow.attempts` exists and
  nothing increments it, so `sync/push.ts` writes `localDb.outbox` directly. It belongs
  in `queries.ts` next to `ackOutbox`.
- **`stages`, `session_logs` and `checkpoints` carry no `user_id`** — they hang off
  `goals`/`stages` — so the pull reads them unscoped. Correct for single-user v1; auth
  needs a join there, which is additive.
- **A permanently rejected outbox row is never dropped.** It keeps its FIFO place, its
  `attempts` climb, and it shows in the pending count. Rows behind it still land (per
  change, not per batch), so it does not block the queue — but nothing discards a write
  the user made.
- **`push_subscriptions` upserts on `id` while the table is unique on `endpoint`.**
  Unreachable today: nothing writes that table locally, `api/push/subscribe` authors it
  server-side and pull brings it down. A local write path must reuse the server's id or
  it becomes a permanently rejected row.
- **Server-authored `updated_at` is a UTC instant, client-authored is local wall-clock.**
  Only the bootstrap `users` row and `api/push/subscribe`'s rows are server-authored, and
  both compare harmlessly, but the two frames are not the same clock.

**Verification is asymmetric, and the push half is the untested one.** A read-only
`POST /api/sync` with an empty `changes[]` ran every pull query against Supabase and came
back with the bootstrap user row and nine cursors — that path is live-verified. The push
path is **not**: its SQL was rendered through `drizzle.mock` and read, never executed,
because exercising it means writing rows into the production database. So three things
are unproven against Postgres — `setWhere` actually suppressing an update under a real
conflict, the `planWeeks` transaction with `.for("update")`, and foreign-key ordering
across a real multi-table batch. First real two-device sync is the test.

---

### D2 — push infrastructure is live (supervisor take-over)

Handed over mid-way. VAPID keys and `CRON_SECRET` were already set in Vercel; the
deploy was failing and the Supabase step was untouched. Both now done and **verified
end to end**, not just configured.

**1. Three production deploys had been failing** with `DATABASE_URL is not set →
Failed to collect page data for /api/cron/remind`. Two causes:

- The Vercel project genuinely had no `DATABASE_URL`. Now set for production, preview
  and development.
- **The build should never have needed it.** `db/server/client.ts` threw from module
  scope, and Next.js collects page data by importing every route, so an absent
  credential failed the *compile step*. The client is now created lazily behind a proxy
  on first property access — same single pooled connection, deferred past build.
  Verified by building with `.env.local` moved aside entirely. This also unbreaks
  building the repo without a database, including CI.

**2. `pg_cron` + `pg_net` enabled, four jobs scheduled, chain proven.** Fired the exact
`net.http_get` the job runs and read the response out of `net._http_response`:
`status_code 200`, body `{"sent":0,"pruned":0}`. Zero is correct — no device has
subscribed yet.

**3. The cron SQL had a real timezone bug.** `pg_cron` evaluates schedules in the
database timezone, which on Supabase is **UTC**, but daypart boundaries are wall-clock
local (D53). The committed file used `0 5 * * *` for the 05:00 daypart, which in IST
fires at **10:30 local — five and a half hours late, every day, silently.** Corrected
to the UTC equivalents (`30 23`, `30 6`, `30 11`, `30 15`) with the conversion table in
the file. **These do not track the dayparts table**: editing boundaries in settings
(D44) does not reschedule anything, by design — a server-side job cannot read the
user's dayparts without the server knowing the plan, which is the coupling D33/D34
removed.

**Gotchas worth keeping:**

- **`dotenv`'s startup banner goes to stdout.** `$(node -e "require('dotenv')...")`
  captures `◇ injected env (6) from .env.local …` *along with* the value. This silently
  corrupted the `DATABASE_URL` pushed to Vercel — the stored value had the banner
  prepended, and the endpoint failed with `ERR_INVALID_URL`. It also produced a
  `PROTOCOL_ERROR` when the same trick built an `Authorization` header. Read secrets
  with `grep '^KEY=' .env.local | cut -d= -f2-`, or pass `{quiet: true}`.
- **A deployment reaching a terminal state is not a deployment that succeeded.** Poll
  for `Ready` specifically; `Error` is also terminal, and the old deployment keeps
  serving 200s in the meantime, so curl checks look green while the newest build is
  broken.
- **`cron.job_run_details` only reports that pg_net *queued* the request**, not the
  HTTP result. Read `net._http_response` for status codes.
- The `CRON_SECRET` is stored in plaintext in `cron.job.command`. Inherent to calling
  an authenticated endpoint from pg_cron; rotating the secret means rotating it there.

**What is left for the user:** open the deployed app on the Android phone, install it,
Settings → Reminders → *Turn on reminders*, and confirm a notification arrives at the
next daypart boundary. Until a device subscribes, `sent` stays 0. **D36 is not signed
off until that notification lands on the phone.**

---

## Decisions still open

Tracked in `DECISIONS.md` under "Open questions". Currently outstanding:

- ~~**First-run seeding**~~ → **resolved by Wave 2.0:** seed defaults. `db/local/seed.ts`
  writes four dayparts on an empty device, through `putDaypart` so they sync. They are
  editable in settings, which is what makes seeding safe.
- **Display face** — Inter throughout, or a warmer serif for the one big number per
  screen? Not blocking.
- ~~**`auto` theme boundary**~~ → **resolved by Wave 2a:** dark begins at the user's
  own *night* daypart (whatever they've set it to), not a hardcoded clock time —
  `hooks/use-theme.ts` reads it live from Dexie.
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
- **`@serwist/next` does not work on Next.js 16** — webpack-only, and Turbopack
  is the Next 16 default. Use `@serwist/turbopack`. The worker is a route
  handler, not a bundler plugin, so there is no `public/sw.js`.
- **`src/app/serwist/[path]/route.ts` is server-only code outside the `api/**`
  carve-out.** The D42 lint guard exempts `src/app/api/**` from the no-`fetch`
  rule; `app/serwist/` is not exempt and doesn't need to be, because the route
  makes no network call. Lint passing there is not permission to put
  UI-adjacent network code under `app/serwist/`.
- **`createSerwistRoute` needs `useNativeEsbuild: true` pinned.** It defaults to
  `false` on anything that isn't Windows, which imports `esbuild-wasm`. A local
  Windows build therefore passes while the Vercel (Linux) build dies with
  `Cannot find package 'esbuild-wasm'`. Pinned true, and `esbuild@0.28.1` is now
  a declared devDependency instead of a transitive hoist from vite.
- **A green local build does not mean a green deploy.** The one platform
  difference above cost a red production deployment. `npx vercel inspect --logs
  <url>` is how to read the failure; `npx vercel ls` shows deployment status.
- **`npm run build` is the only check that exercises the service worker.** Lint
  and tests both pass on a tree whose PWA build is broken. Run the build before
  pushing to `main` — it auto-deploys (D40).
- **`npm run build` needs `DATABASE_URL` set**, even locally, because
  `api/push/subscribe` reaches the DB client at module scope and Next collects
  page data for every route at build time. Not a bug introduced by any track —
  export any syntactically valid Postgres URL for a local build; the real value
  only matters at runtime.

### Wave 4 — Tracking
**Done.** Built in `../my-time-tracking` on `track/wave4-tracking`.

Confirmed the supervisor's readiness note: `core/pace.ts` and
`features/checkin/goal-status-row.tsx` needed no changes. This wave only added the
`/goals/[id]` detail screen — the same numbers Today shows, given room to breathe,
plus history views Today never had reason to.

- `src/features/goals/goal-detail/` — new:
  - `goal-detail.tsx` — orchestrator, finds the `(goal, stage)` pair the same way
    `goal-edit.tsx` already does (`getGoalsWithStage()`, client-side find — still
    no single-goal read in `queries.ts`, noted again below).
  - `pace-summary.tsx` — cadence required/actual, the arithmetic scope line, the
    measured line, and the projection range, calling `goalPaceStatus` from
    `features/checkin/lib.ts` verbatim. No new arithmetic anywhere in this wave —
    `measuredPerUnit == null` still renders nothing (D25), the projection is still
    a range, never a point (D25, D57).
  - `session-history.tsx` — paginated, "Load more" pattern copied from
    `app/missed/page.tsx` (same dev-mode-double-invoke guard via a ref). Skipped
    sessions render in `text-neutral` (design.md §2.3) — information, not a
    verdict.
  - `checkpoint-history.tsx` — a single bounded `getCheckpointsForStage(stageId,
    { limit: 100 })` read, no pagination UI. Checkpoints are sparse by design
    (D13, weekly at most), so 100 covers years; this is not the "bounded page"
    pattern the session history needed.
  - `lib.ts` — `sessionHistoryPage`, the one new piece of logic this wave added.
- `src/app/goals/[id]/page.tsx` — extended, not replaced: `GoalDetail` renders
  above a `Separator`, `GoalEdit` (untouched) below it. The page no longer has a
  fixed "Edit goal" h1 — the goal's own name is now the h1, "Edit goal" moved to
  an h2 above the existing form.

**The query gap flagged, per the track brief ("report it, don't add it")**:
`db/local/queries.ts` has no per-stage paginated session read. `getSessionLogPage`
paginates `sessionLogs` globally, keyset on `[date+id]`, with no `stageId` filter —
fine for a cross-goal feed, wrong shape for "this goal's history." Rather than add
a `[stageId+date+id]` index to a file Wave 3 owns concurrently,
`goal-detail/lib.ts`'s `sessionHistoryPage` scans a bounded number of the existing
global pages (`MAX_UNDERLYING_PAGES_PER_SCAN = 8`) and filters by `stageId`
client-side — same shape as `missedOccurrencesPage`'s bounded week-by-week scan,
same tradeoff: correct and D47-bounded, but a stage that logs rarely relative to
every other active goal combined pays for more underlying page reads per "Load
more" click than a dedicated index would need. Worth a real `[stageId+date+id]`
index if per-goal history turns out to be a heavily used screen.

**Verified:** `npm run lint`, `npm run test` (111 tests, unchanged — UI needs
none), `npm run build` (with `DATABASE_URL` set locally, see above) all pass.
Checked in-browser via Claude-in-Chrome in both themes: created a scoped goal
("GATE prep", 30m/3×week, scope `chapter`/30, target date 2026-12-31), confirmed
the pre-data state (arithmetic scope line shown, measured/projection correctly
absent — D25), then logged one voluntary session and one checkpoint (`3`) and
confirmed all four pace lines render, the session appears in history as "Done ·
voluntary", the checkpoint appears with its logged time, and the on-track dot is
sage (not a hardcoded green) in both light and dark. No goal state existed to
exercise a skipped session or a second page of history — only the empty and
single-entry states were verified live; the pagination path itself was verified
by code review against the `missedOccurrencesPage` pattern it copies, not against
a live 50+-row stage.

---

## Session — 2026-07-30/31 · Wave 3 + Wave 4 merged, D59 added

**Both waves are on `main` (`7716d05`).** Wave 3 then Wave 4, zero file conflicts —
`docs/memory.md` was the only shared file and merged automatically. Path ownership has
now held across two waves; every failure remains at the seams no track owns.

**Gates:** lint clean, 170 tests / 13 files (was 165, +5 for D59), production build OK.

### What the gates could not see, and had to be checked live

Wave 3 was the first code to touch real Postgres with the text ids, so the merge was
verified with real requests against the database, not only the fake transport:

- **`db.transaction` through the lazy client Proxy.** The Proxy was added during D2 and
  the cron endpoint only ever proved `select`/`delete` through it. `applyPlanWeek` uses
  a transaction, and `this` inside it resolves through the Proxy. Confirmed working
  (`applied:[1]`). Drizzle's `PgDatabase` has no `#private` fields, so the receiver
  never becomes a problem — worth knowing before anyone "simplifies" that Proxy.
- **`server_updated_at` bumps on UPDATE, not only INSERT.** It is the pull cursor, so if
  it did not, an edited row would never reach the other device — silent, permanent
  divergence that no test in `tests/sync/**` can reach. Verified: a winning write moved
  the cursor.
- **A losing write does not move the cursor.** A stale v1 pushed after v2 was refused
  and left `server_updated_at` alone, so it did not re-broadcast to every device. This
  is the behaviour the `ON CONFLICT ... WHERE` guard exists for.

A synthetic `week-2026-07-27` was written during that check and **deleted afterwards** —
an empty week with a late `updatedAt` can win LWW and take a real week's slots with it.
The database held no real rows at the time.

### D59 — the sync endpoint was wide open

Wave 3 put every row the app holds behind one unauthenticated `POST /api/sync` on a
public URL. Not a Wave 3 mistake — auth is deferred by decision — but a change in kind:
`/api/push/subscribe` only let a stranger add a push token.

Shipped: a shared `x-sync-key` header (`SYNC_KEY` + `NEXT_PUBLIC_SYNC_KEY`, same value,
set in `.env.local` and all three Vercel environments). **It is labelled "not
authentication" everywhere it appears**, because `NEXT_PUBLIC_` inlines it into the JS
bundle and Serwist precaches that bundle — anyone who opens devtools can read it. It
deters crawlers and nothing else. Real access control is **O14**, not built.

The load-bearing part is the 401 handling, not the key. Every transport failure
previously took the backoff path, so a rotated key — or a client still serving a
precached bundle with the old one — would have retried forever, never drained the
outbox, and shown an ordinary `pending` with no explanation. A 401/403 now sets
`blocked`, skips the retry, and clears on the next accepted run. The check **fails open
when `SYNC_KEY` is unset**, deliberately: that is today's behaviour, and a wedged outbox
is harder to notice than an open endpoint.

Rejection reasons were returning the failing SQL with its column list to an
unauthenticated caller; trimmed to `"<op> on <table> was refused"`, detail to the server
log. Nothing on the client reads `reason` (only `seq`), which is what made that safe.

**Test note worth keeping:** `scheduleRetry` early-returns when `window` is undefined,
and the suite runs in node — so "no retry fired" is trivially true there and a
timer-based assertion proves nothing. The D59 tests assert the `blocked` branch that
decides it, plus the consequences that are observable (outbox intact, flag clears). An
earlier version of one test re-`install`ed the transport to flip behaviour; that calls
`configureSync`, which resets engine state, so it passed vacuously. It now flips a
mutable status on the same transport.

### Not verified, and why

The deployed production key was **not** confirmed with a request. Preview URLs sit
behind Vercel SSO (every curl gets Vercel's own 401 before the app runs), and direct
curls to production were blocked in this environment. The values were piped from one
generated key with `grep`/`cut` — the method that avoids the dotenv-banner corruption
that broke `DATABASE_URL` — and all six writes reported success, but that is inference,
not proof. **First person to open the app should check the sync indicator: anything
other than the blocked icon (a slashed circle) means the keys match.**

### Still open

- Supabase database password rotation (exposed in Vercel log output on 2026-07-29).
- D36 sign-off: notification actually arriving on the Android phone.
- O14: real access control for `/api/sync`.

---

## Session — 2026-07-31 · sync was silently broken in production; two fixes

Reported as *"I entered 5 goals on my laptop and nothing appears on my phone"*, plus a
status indicator that never settled. Both were real, and they were two different bugs.

### 1. The LWW guard could never execute (the reason nothing synced)

`route.ts`'s `newerThanStored` built the `ON CONFLICT ... WHERE` clause as
``sql`${column} < ${date}` ``. A raw `sql` template binds its value **without reference to
the column**, so the JS `Date` never reached the `timestamptz` encoder and postgres.js
refused the whole statement:

```
The "string" argument must be of type string or an instance of Buffer or
ArrayBuffer. Received an instance of Date
```

Every mutable table upserts through that one helper, so **every `users` / `dayparts` /
`goals` / `stages` / `pushSubscriptions` push had been rejected on every device since the
first sync.** `planWeeks` skips the guard and the append-only tables use
`onConflictDoNothing`, so those synced fine — which is why the database held a plan week
and zero goals, and why it read as a data problem rather than one broken function.

Fixed with `lt(column, date)`, which binds against the column. The four raw templates in
`applyDelete` had the same defect and are fixed too.

**Why nothing caught it, and what changed.** `tests/sync/**` runs against a scripted
transport; the SQL *string* is correct, and rendering it through `drizzle.mock` — which a
previous session did — shows nothing wrong. The failure is in **encoding a parameter**,
which only a real driver does. New `tests/sync/lww-guard.pg.test.ts` runs the real
statements against Postgres inside always-rolled-back transactions, and was **verified to
fail on all four cases against the old helper**. It is skipped when `DATABASE_URL` is
absent, so it protects a local `npm run test` and **not** CI — a real limitation, stated
in the file rather than papered over. A throwaway Postgres in CI is the proper fix and is
a D50 decision nobody has made.

### 2. The engine re-triggered itself on a refused row

The write-trigger watched outbox **depth** through `liveQuery`. Dexie re-fires `liveQuery`
on any mutation to an observed table, not only when the observed value changes — and
`settlePush` bumps `attempts` on every rejected row. So: sync → reject → bump → sync, one
request per 1.5s debounce, forever. Proven with `fake-indexeddb`: three attempts-bumps
with the count unchanged produced four emissions.

Its only symptom is an indicator that never settles, which reads as *"working on it"*
rather than as a fault. **It does not go away with bug 1** — a permanently rejected row
still re-creates it, which this file already warned was possible.

Now watches `getOutboxHighWaterMark()`. `seq` is `++seq` and Dexie never reuses a value,
so it moves only on a genuine enqueue and can be raised by neither an update nor an ack.

### Verified live, not merely built

`lint` clean, **177 tests** (was 170), production build OK. Then, against a dev server on
the real Supabase:

- Loading the app **once** drained a queue stuck since 30 July — 4 dayparts, 1 goal, 1
  stage, 1 session log, 1 checkpoint all landed, and the indicator reached the checkmark.
- **Wiped the client's IndexedDB and its `localStorage` cursors, reloaded, and the goal
  and all four dayparts came back down from the server.** That is a real second-device
  pull, and it is the first time cross-device sync has actually been observed working.
- Created a goal through the UI → on the server within seconds.
- Dropped it through the UI → the *edit* propagated, which is the first time the
  `setWhere` conflict path has run against real Postgres under a genuine conflict.
- Idle for 20s with the outbox empty: **zero** requests to `/api/sync` (before the fix
  this window would have held roughly a dozen).

### Things this turned up, worth keeping

- **The empty `week-2026-07-27` hazard resolved itself.** It held version 4 with zero
  slots because layout had no goals to schedule. Once goals synced, a relayout produced 5
  slots and won LWW. No manual deletion was needed — but the risk was real, and this file's
  own warning about an empty week beating a real one is what flagged it.
- **The user's laptop data is in Firefox, not Chrome.** `push_subscriptions` carries the
  device label, which is how that was established.
- **Bug 1's fix is server-side.** Existing clients recover on their next sync without a new
  bundle. Bug 2's fix is client-side and needs the deploy to reach each device.
- A `Sync verification goal` exists on the server in state `dropped` — created to prove
  push, then dropped through the app's own path (D48, never a hard delete). It is
  invisible in the UI. Two verification `check_ins` from the same session remain; they are
  append-only facts and removing them would violate D32.
- **`npm run test` now touches the network** when `.env.local` is present, via
  `process.loadEnvFile`. Node 22 built-in, no dependency added (D50).

---

## Session — 2026-07-31 (2) · review triage, and the daypart cap (D60)

A review produced 16 findings. They were triaged into six groups; **only the capacity
one was built.** The rest are written up below so another session can take them without
re-deriving the analysis.

### What was built — D60, the daypart cap

`activeCap` was enforced **nowhere**. `layoutWeek` ignored it completely, and
`getDaypartCapacity` counted a stage against every daypart it was *eligible* for — so
two goals eligible everywhere reported all four dayparts "2 of 2 used" with no plan in
existence. Eligibility is a set (D7); a session lands in exactly one member. Occupancy
is not knowable at goal-creation time, so the cap moved to the only place that knows:
layout, keyed by `(date, daypart)`.

Changed: `core/layout.ts` (occupancy map, enforced in **both** `retainValidExisting` and
`placeRemaining`), `db/local/queries.ts` (`getDaypartCapacity` now reads `planSlots` and
takes `now`), `features/goals/goals-list.tsx`.

**Two things worth knowing before touching this again:**

- **Retention enforces the cap too, and must.** A retained slot occupies its daypart
  exactly as a fresh one does, so a cap checked only on placement is silently exceeded
  by any week laid out before the cap was lowered. This is the D54 failure shape,
  repeated — that bug was "enforced in `placeRemaining`, not in `retainValidExisting`".
- **Retention is now scarcest-first, not map-insertion order.** Once the cap can drop a
  retained slot, insertion order becomes observable, and `existing` is not guaranteed
  sorted by the caller. A test asserts the result is identical when `existing` is passed
  reversed.

`getDaypartCapacity` returns two numbers instead of one — `usedToday` and `freeDays` —
because one cannot answer "can I start another goal in the evening?": a daypart can be
full tonight and open four other days. Renders as *"Evening: 2 of 2 today · room on 6 of
7 days"*.

**Verified:** lint, **184 tests** (+7), build. Four of the seven new layout tests were
checked to fail with enforcement disabled. Then on real data in-browser: forced a
relayout with 6 active stages against `activeCap: 2`, got 12 slots over the 3 remaining
days with **zero `(date, daypart)` over 2**, morning and evening sitting exactly at the
cap, and the goals screen showing four *different* numbers where it previously showed
four identical full ones.

**Known gap, recorded in D60 rather than fixed:** `pace.cadenceStatus` computes
feasibility from rest gaps and `maxPerWeek` and knows nothing about the cap, so a stage
starved by a full daypart is under-placed without the check-in screen explaining why.

### Found while verifying — a pulled goal is never scheduled

**`relayoutWeek` is called from four UI sites** (goal form ×2, daypart settings,
check-in) **and from nothing in `sync/`.** So a device that receives goals, stages or
dayparts by pull keeps whatever plan it already had until the user happens to save
something locally.

Observed directly: this checkout pulled down 5 goals / 6 active stages and the plan
still held **2 slots**, laid out when one goal existed. The phone will show the goals
and an empty Today.

Not fixed here because the fix is a layering decision, not a patch: `sync/` calling
`features/plan/planner` inverts the dependency direction (sync is below features), and
the alternatives — a callback injected at `configureSync`, or a UI-level effect watching
`lastPullAt` — are different architectures with different owners. **Wants a decision,
then roughly ten lines.** This is the highest-value item outstanding.

### Triage of the remaining findings

Grouped by root cause, not by report order. Groups A–C are independent of each other and
of anything above — safe to hand to separate sessions.

| Group | Findings | Root cause / note |
|---|---|---|
| **A · Copy and vocabulary** | rename "cadence"; describe active cap; explain scope; drop the D-number from the UI; purpose field; daypart times on hover in the goal form | The goal form never explains itself. All text. **`goal-form.tsx:377` is the only user-visible D-number in the app** — the two others are in `/styleguide`, a dev page. |
| **B · Numeric inputs** | session length wants h+m; "sessions per week" will not clear; check-in should ask h+m | One cause: `Math.max(1, Number(e.target.value))` coerces on **every keystroke**, so clearing the field snaps it back to 1. `maxPerWeek`/`minRestDays` already use the correct pattern (string state, coerce on submit). Wants a shared `DurationInput` + `NumberInput` — the input-side twin of `formatDuration`. |
| **C · Navigation and lists** | set goal state from the goals list; click through to a goal from the check-in rows; "Load more" showing with nothing to load | `hasMore` starts `true` and only clears once a bounded scan comes back empty, so it always renders at least once. Also here: the **"New goal" button logs a Base UI accessibility error** — `<Button render={<Link/>}>` needs `nativeButton={false}`. Pre-existing. |
| **D · Protocol coherence** | weekly max and min rest days "mismatch" cadence | Real, not cosmetic: `layout.ts:54` does `required = Math.min(required, maxPerWeek)`, so **weekly max silently overrides the stated cadence** — 5×/week with a max of 3 schedules 3, with nothing said. D20 intended it as a recovery ceiling for *voluntary catch-up*, not a scheduling input. Needs a decision before code. |
| **E · Capacity** | — | **Done, D60.** |
| **F · Goal targets and structure** | goal-level target date → suggested sessions/week; GATE → subjects → chapters; configurable week start | Largest. See below. |

### Notes on group F, so it is not restarted from scratch

- **The target-date item does not need AI.** It was reported as *"with ai suggest
  sessions per week"*, but **D19** (compute the required rate backwards, budget-first)
  and **D25** (the required line is pure arithmetic, ships day one, needs zero data)
  already specify it as division. D39 defers AI to v2; this is not AI work, and treating
  it as such is what has kept it unbuilt.
- **The hierarchy item is D18/D23**, already designed: GATE → syllabus → revision → test
  series, with **D24** deriving each stage's deadline backwards. The schema has a real
  `stages` table; only the UI assumes one stage per goal.
- **But "GATE → subjects → chapters" mixes two axes.** D18's stages are *sequential
  phases*; subjects are *parallel* divisions; chapters already exist as scope units
  (`scopeUnitLabel`/`scopeUnitTotal`). Building three nesting levels would contradict
  D12 and D23. Settle the axis before writing code.
- **Week start is hardcoded Monday** in `core/dateUtils.ts` (`isoWeekStart`), and both
  `pace.ts` and the new `getDaypartCapacity` depend on it. Making it configurable is a
  settings field plus a threaded parameter through the pure core — small, but it belongs
  to whoever is already in that file.

---

## Session — 2026-07-31 (3) · Today opens on the plan (D63)

Branch `ui/today-first`, off a `main` that now has D60 and D61 merged (both were
verified green together before branching: lint, 184 tests, build).

**Today was a gate.** The session list did not exist until the user typed a number and
pressed "Check in", and `logSlot` early-returned unless a check-in was active. Now Today
shows the sessions the plan put in the current daypart, and stating available time is an
explicit panel called **"Adjust today"**. Recorded as **D63**; `PRD.md` §5 and §6.5 and
`Architecture.md` §9.2 updated in the same change, as CLAUDE.md requires.

**D8 is not contradicted and the decision says so explicitly** — the plan is still laid
out ahead, reconciliation still happens on a stated time, and D8's "the gap is visible
immediately" is better served now that *"2h 30m planned · 1h 45m left"* is on the
default screen instead of behind a form.

### Things worth knowing before touching this again

- **`reconcileNow`'s `availableMinutes` is `number | null`, and `null` is a real
  branch.** Not a large sentinel: `core/reconcile.ts` allocates a knapsack table of
  `availableMinutes + 1` cells, so `Infinity` throws and "big enough" quietly allocates
  an enormous array (D47) — on the *default* path of the main screen. 4 new tests in
  `tests/features/planner.test.ts`, **all verified to fail without the branch**.
- **The unpacked default is a decision, not laziness.** Packing against the daypart's
  remaining time would show "won't fit" unasked, which presumes the evening is free —
  the unrequested verdict D21 rules out. "Won't fit today" appears only after a time is
  stated.
- **Stated time lives in the `check_ins` row, not React state.** `getLatestCheckIn` was
  already there, bounded on `[date+daypartId]`, and was dead code. Time already spent is
  now *derived* from the day's `session_logs` instead of a manual `setRemainingMinutes`
  decrement — reload-safe, and it cannot drift from what was recorded. Only `done`
  counts; a skip must not shrink the remaining budget.
- **Two loading races, both closed.** `getLatestCheckIn` resolves to `undefined` when
  the user never stated a time, which is indistinguishable from `useLiveQuery`'s "still
  loading" — same trap `dataReady` exists for, so it is wrapped as `{ row }` and the
  loader is held until it settles. Without that, anyone who had stated a time saw the
  full list render and then visibly re-pack. And `<AdjustToday>` is **keyed** on the
  stated value, because it seeds its input from a prop in `useState`, which runs once
  per mount.
- **Only the goal's name links to its page**, not the whole card. Done and Skipped are
  why the card exists and are tapped far more often; a card-wide link sits under both
  waiting to swallow a mis-aimed tap on a phone.
- The stored concept keeps its name — `check_ins`, `LocalCheckIn`, `CheckIn`,
  `putCheckIn`, the `checkIns` sync table. Renaming would reshape the schema, a frozen
  types file and the sync protocol at once (D51). **UI text only.**

### Verified

`npm run lint`, **188 tests** (+4), `npm run build` — and, after merging, **197 tests**
on `main`.

Browser verification was blocked at first (Claude-in-Chrome "not connected" *and*
Playwright MCP holding a profile lock, simultaneously) and was completed afterwards
through **Playwright MCP** once the lock cleared. All six checks pass, **zero console
errors or warnings** across the whole run:

1. **Today opens on the plan** — heading, "Adjust today", *"Night · ends 05:00"*,
   *"1h planned · 7h 34m left"*, session cards. No form, no "Check in".
2. **Done with no time ever stated** — the path the old `activeCheckIn` guard blocked.
   Logged `done`/`planned` against the right date and daypart, and **no `checkIns` row
   was written**, which is the point: logging no longer costs a check-in.
3. **Adjust today → 20 minutes** (less than one 30m box) — gap line switched to *"20m
   stated · 0m left"*, "Won't fit today" appeared, and the block contains **zero
   buttons** (D27).
4. **Reload** — still *"20m stated"*, still packed. The `check_ins` round-trip works.
5. **"Show everything again"** — back to *"1h planned · 7h 32m left"*, won't-fit gone.
   Re-opening the panel showed the field pre-filled with `20`, proving the keyed
   remount fix; the button itself only appears when a time is stated.
6. **Daypart outside `now`** (picked Morning while in Night) — "Remaining" reads **—**,
   not "0m".

Not exercised live: the night-daypart wrap across an actual midnight (D53). It is
covered by `tests/features/planner.test.ts`'s existing anchor test, and every read and
write on this screen keys off `daypartDate`, but no one has sat through 00:00 with it.

**Follow-up, done once `ui/goal-form` landed:** the panel now uses W2's shared
`DurationField` (hours + minutes) instead of a raw minutes box — the last outstanding
piece of the cancelled check-in-screen track. Verified live: 1h 30m stores as `90`, and
the gap line reads *"1h 30m stated · 1h left"* against 30m already logged.

One thing that changed with it, and is a deliberate choice rather than a port:
`DurationField` always holds a number, so there is no "empty" state to disable the
primary button on the way the old free-text field had. Seeding at **0** would mean
opening the panel to look at it, pressing "Pack the list", and watching every session
fall into "won't fit" — the app concluding the user has no time because they never said
otherwise. It seeds from the minutes actually left in the daypart instead (or the
daypart's length when `now` is outside it), which is a number already on screen in the
stat row. `min={0}` is passed explicitly, overriding the component's default of 1,
because "no time at all" is a legitimate answer *here* while a zero-length session
never is.

---

## App icon and loading mark (D61) — on `feature/dart-icon`, not yet merged

The app icon and the check-in view's loading state are now a **dart and dartboard**,
carried over from `task-shot 2.0`'s `src/components/Loading.tsx`. Board is
`accent-fill`, dart is `ink` — two tones, no red (§2.3). Static mark and animated loop
share one set of coordinates in `src/components/dart-mark.tsx` (`DartMark`,
`DartLoader`), so the loop's resting frame and the generated icon files are provably the
same drawing.

**This amended `design.md` §6.1/§6.2 and added D61**, agreed with the user in-session:
infinite CSS animation is now allowed when it's declarative and compositor-only
(`opacity`/`transform`, no JS driving it) — the "nothing infinite" rule was protecting
against a JS-driven main-thread loop, not against looping per se. Shimmer/pulsing
dots/parallax stay banned on the separate §1 "must not pull attention" grounds. Read
D61 for the full reasoning before touching §6.1 again.

**What changed:**
- `src/components/dart-mark.tsx` — new. `DartMark` (static) and `DartLoader` (the
  infinite loop), sharing geometry constants.
- `src/app/globals.css` — the loop's `@keyframes` and a `prefers-reduced-motion`
  override more specific than the file's existing blanket collapse (that blanket rule
  would otherwise land the reduced-motion state on the loop's fully-faded frame).
- `src/features/checkin/checkin-view.tsx` — added a `dataReady` signal (a fourth,
  narrower `useLiveQuery` alongside the existing `dayparts`/`activeGoals` ones, since
  those already default to `[]` and can't distinguish "loading" from "loaded empty")
  and a loading branch that renders `<DartLoader>` before first paint of real data.
- `public/icons/*.png` and `src/app/favicon.ico` — regenerated from the new mark, via a
  throwaway Node script (not committed — built on `zlib` only, no rasteriser dependency
  per D50) that shares the same coordinates as `dart-mark.tsx`.
- `docs/design.md` §6.1, §6.2, §6.3 — amended per D61.
- `docs/DECISIONS.md` — D61 added.

**Verified:** lint clean, all 184 tests pass (includes the in-flight, uncommitted
`layout.ts`/`queries.ts`/`layout.test.ts` changes already on `main` when this branch was
cut — untouched, carried along), production build clean. Generated PNGs viewed directly
and match the approved design — rings, sharp-tipped dart, correct colours at both 512px
and 192px. The app itself loads without console errors with the new import wired in.

**Not independently re-verified in a live browser:** the actual in-app loading frame.
Local Dexie/IndexedDB reads resolve fast enough that two attempts at screenshotting the
real check-in page during first load both landed after `dataReady` had already flipped
true — the loader never appeared in the capture window. The CSS itself (identical
keyframes and geometry) was interactively confirmed to animate correctly in an earlier
Artifact iteration; what's unconfirmed is only the live DOM mount, not the animation
mechanism.

**Landed.** Committed on `feature/dart-icon` as `dd38bed` and merged to `main` (D61),
alongside the daypart-cap work as its own commit (D60). The two were kept separate: they
shared only `docs/DECISIONS.md`, and the cap change was staged as a D60-only version of
that file so neither session's decision swept up the other's.

---

## Session — 2026-07-31 · W1: a device that pulled goals kept its old plan (D62)

`relayoutWeek` had exactly four callers — `goal-form.tsx` (×2), `daypart-settings.tsx`,
`checkin-view.tsx` — and **nothing in `src/sync/`**. Every one of those is a *local*
edit, so a device that received goals, stages or dayparts **by pull** kept whatever plan
it already had. The goals showed up in the list; Today stayed as it was. Nothing errored
and nothing said so.

### The decision (D62) — injected, not imported

`sync/` sits below `features/`, so it cannot reach `relayoutWeek`. Three options were on
the table; two are recorded as rejected in `DECISIONS.md` because they are wrong in ways
that are not obvious:

- **`sync/` imports the planner** — inverts the layering, and no ESLint guard catches it.
- **A UI effect on `lastPullAt`** — *cannot work*. `memo.write({ cursors, lastPullAt })`
  runs on every round of every run, so `lastPullAt` moves even when zero rows arrived. An
  effect on it re-plans, which enqueues, which bumps the outbox high-water mark, which
  the write-trigger watches → sync → new `lastPullAt` → re-plan. That is the D47 loop
  rebuilt from different parts.

What shipped: the UI hands `relayoutWeek` down as an argument to `startSync`; the engine
knows only the shape (`RelayoutAfterPull`). `use-sync-status.ts` is the composition root —
it already starts the engine and is on the UI side of the seam.

Registration is on `startSync`, **not `configureSync`**: the latter resets `state` and
nulls `inFlight`, so a StrictMode-double-invoked effect would clear a live run's
coalescing guard and re-push the head of the outbox.

The trigger is a new `ApplyOutcome.inputsChanged` — true only when a daypart, goal or
stage row was *written*, not merely received. `planWeeks` are excluded because they are
layout's output, so nothing the re-plan itself writes can re-trigger it. Held in a
module-level flag that clears only when the re-plan returns, so a throw is retried on the
next run rather than lost.

### Verified with a control, which is the part that mattered

`lint` clean, **186 tests** (was 177), production build OK. Then two Chromium contexts,
separate profiles, two ports — different origins so genuinely different IndexedDB —
against the one Supabase. **`origin/main` was built and served the same way as a
control.** Only device B's build matters: A merely has to create a goal and push it,
which any build does, and every assertion below is about B.

The scenario is the reported shape, not the easy one. A fresh device that pulls A's plan
week gets a correct plan *without* any fix, so that proves nothing. Instead: B goes
offline, edits a daypart (a local re-plan, stamping B's week later than A's), and only
then pulls. A's week loses the LWW race, so the plan cannot arrive that way.

| | control (`origin/main`) | with D62 |
|---|---|---|
| B received the goal | yes | yes |
| B's slots for its stage | **0** | **3** |
| B's plan week across the pull | v14 → v14, unchanged | v11 → **v12**, B's own clock |
| `/api/sync` requests in the 20s after | 0 | 0 |

The week going to version+1 with B's own timestamp is the discriminator: B's UI did
nothing between the daypart save and the pull, and `relayoutWeek` has no other trigger —
so that re-plan came from the engine. Both runs quiescent, so the loop trap was avoided.

### Left behind, worth knowing

- **Session logs deliberately do not trigger a re-plan** — reasoning in D62. They *are* a
  layout input (`checkin-view.tsx` re-plans after every local `logSession`), and including
  them would be loop-safe, but layout depends on `now`, so two devices re-planning off
  each other's logs trade slightly different weeks on every check-in. **The cost: a device
  shows a session another device already completed until its next local re-plan.** Fix is
  one more counter in `applyPull` if it turns out to be annoying in use.
- **D60 and D61 were already taken** by `fix/daypart-capacity` and `feature/dart-icon`,
  neither merged to `main`. This took D62. Check every live branch before claiming a
  number, not just `main`.
- **Three junk goals named `Cross-device …` are now on the server**, one per verification
  run. They are `active` and will occupy plan slots. Drop them through the UI — nothing
  here hard-deletes (D48).
- Two servers off one `.next` build (`next start -p 3000` / `-p 3001`) is the cheapest
  two-device rig there is: separate origins, separate IndexedDB, one server. Worth reusing.
  Note other worktrees hold ports in the 3000–3003 range; check before assuming a port is
  yours.

---

## W2 — Goal form: copy + numeric inputs (`ui/goal-form`)

Owned files only: `src/features/goals/goal-form.tsx`, `src/features/settings/daypart-settings.tsx`,
new shared components under `src/components/`.

**Numeric input bug fixed.** `Math.max(1, Number(e.target.value))` on every keystroke made
cleared fields snap back before the user could retype — hit "Session length" and "Sessions
per week". Built two shared components that hold local string state while focused and only
coerce (clamp, default) on blur:

- `src/components/number-field.tsx` — plain number input, `value`/`onChange` in numbers.
- `src/components/duration-field.tsx` — hours + minutes pair, combines to total minutes.
  Used for session length since sessions are often 1h+ and a bare minutes field is tedious
  to type ("90").

Both use React's adjust-during-render pattern (`if (value !== prevValue) setPrevValue(...)`)
to resync from external prop changes (e.g. loading a different goal to edit) — a `useEffect`
doing the same setState is flagged by the `react-hooks/set-state-in-effect` ESLint rule
already wired into this repo's lint config.

**Copy fixes**, all per the session brief:
- "Cadence" → "How often".
- "Scope (optional)" now explains what scope *is* in plain language (countable work toward
  a total, alongside cadence) instead of just citing D28.
- Removed the literal "(D28)" from user-facing text — D-numbers belong in commits/comments,
  never in UI copy. The two references left in `/styleguide` are a dev-only page and were
  explicitly out of scope.
- Eligible-dayparts checkboxes now show each daypart's start–end time in a tooltip on hover
  (`@base-ui/react` `Tooltip`, already a dependency — no new package).
- daypart-settings "Active cap" now has a one-line description under the input ("Max goals
  scheduled into this daypart at once").

**One layout regression caught in testing:** the new Active-cap caption text, added inside
an unconstrained flex child, was wide enough to squeeze the sibling "Name" field down to
~39px in a browser check (Playwright, since the Claude-in-Chrome extension wasn't connected
this session). Fixed by giving that column a fixed `w-32`. Worth remembering if adding
caption text to any other flex-row settings field: unconstrained text width competes with
flex-1 siblings that have `min-w-0` (the shared `Input` component sets this itself).

**Verified in-browser** (Playwright, both themes via `localStorage['my-time:theme-mode']`):
clearing and retyping every touched numeric field works with no snap-back; editing an
existing goal (DSA, 1h/5×week) correctly populates the duration/number fields on load: the
resync path works, not just the create-form defaults. `npm run lint`, `npm run test` (177
passed), and `npm run build` all green on the worktree.

**Pre-existing, not touched:** a Base UI "expected a native `<button>`" console warning
from `goals-list.tsx` (not an owned file) — noted, not fixed, out of scope.

---

## Session — 2026-07-31 · W3: "Load more" over-render + list-level goal promotion

Worktree `my-time-lists` / branch `ui/lists-pagination`, off `origin/main`. Owned:
`app/missed/page.tsx`, `goal-detail/session-history.tsx`, `checkin/lib.ts`,
`goals-list.tsx`.

### 1. "Load more" appeared before any scan had run

Not a bug in the bounded-scan logic itself — `missedOccurrencesPage` (checkin/lib.ts)
and `sessionHistoryPage` (goal-detail/lib.ts, unowned, left untouched) already
correctly distinguish "the retention window / underlying table is exhausted" from
"this click's bound (`WEEKS_PER_MISSED_SCAN` / `MAX_UNDERLYING_PAGES_PER_SCAN`) was
hit with more left to look at" — both report `hasMore` from the former, not the
latter, which is the right signal.

The actual defect was in the two consuming components: `hasMore` was seeded
`useState(true)`, so on the very first render — before the mount effect's
`loadMore()` had resolved — the button rendered regardless of whether there would
turn out to be anything at all. Reseeded both to `useState(false)`: "haven't looked
yet" no longer reads as "there is more." First load still fires unconditionally from
the mount effect; the button now only appears once a page actually reports more to
fetch.

### 2. Goal state (planned ⇄ active) toggle from the list

Added a small outline button per goal card in `goals-list.tsx` ("Move to active" /
"Move to planned"), `e.preventDefault()`/`stopPropagation()` so it doesn't trigger
the card's own `Link` navigation. Calls the existing `putGoal` mutation directly
(spread the `LocalGoal`, flip `state`) + `relayoutWeek`, same pattern `goal-form.tsx`
already uses — no new mutation added. Toast on success, disabled per-goal while
in flight via a single `togglingId` string.

Deliberately **excludes** `dropped` — that stays a destructive action behind the
edit form (D48) and never appears as a casual toggle next to the others. No
capacity check gates the click: D60's daypart-cap enforcement lives in the
scheduler itself, so an over-capacity promotion is accepted here and simply won't
get slots at layout time — consistent with D21 (capacity is a ceiling reported
after the fact, never a target enforced before the fact). Rebased onto `main`
after D60 landed (this track started before it merged) — kept D60's capacity
section (`describeCapacity`, `usedToday`/`activeCap`/`freeDays`) entirely as-is and
re-applied only the toggle on top; renamed the toggle handler's own `localNow()`
read to `actionNow` so it doesn't shadow the component's mount-time `now`.

### Gates

`lint`, `test`, `build` all clean (197 tests, current `main` baseline). Dev server
verified serving `/goals` (curl 200, HTML renders); could **not** complete an
in-browser click-through — the only available browser tool (Playwright MCP)
reported its Chrome profile already locked by another instance for the whole
session, and the `claude-in-chrome` extension wasn't connected. Logic was traced
by hand instead: both `hasMore` seeds confirmed to gate on the real first-page
result, and the toggle handler confirmed to write through the same
`putGoal`/`relayoutWeek` path the edit form already uses. **A real browser
click-through (empty `/missed`, populated `/missed` and session history, and a
live promote/demote click) is still owed** before this should be treated as fully
verified.

---

## Session — 2026-08-01 · Design session: group F settled (D65, D66, D67)

**No feature code written.** This session existed to close the three items triaged as
group F ("goal targets and structure"), which had been sitting because each needed a
decision before anyone could write a line. All three are now recorded in
`DECISIONS.md` as **D65 · D66 · D67**, and this section is the implementation plan
that follows from them. Everything below is **proposed and unbuilt.**

The ground had moved since group F was scoped — D60 (cap enforced in `layoutWeek`),
D62 (re-plan after a pull) and D63 (Today opens on the plan, PRD §6.5 rewritten) all
landed in between, and two of the three items changed shape because of it.

### D65 — target date → required rate. It is division, not AI

**The report's framing is refuted, and the refutation is the point.** Reported as
*"with AI, suggest sessions per week"*; D19 (compute backwards, budget-first) and D25
(the required line is pure arithmetic, day one, zero data) already specify it, and D39
defers AI to v2. Calling it AI work put it behind a wall it was never on the wrong side
of, which is why it is still unbuilt.

The real gap was an input inventory, not a technique. Three rungs, each needing one
more input: **units/week** (scope + date — day one, always shows) → **sessions/week**
(+ an effort-per-unit figure) → **hours/week** (+ the time-box). Rung 2 is the one
actually asked for and it is wanted **at goal creation**, where no checkpoint exists —
so `sessionsPerUnit` gets an optional user prior, which D17 already sanctions verbatim.
Measured wins as soon as it exists; the two are never blended.

**Work, in dependency order:**

1. **`core/pace.ts`** — `ScopeStatus` gains `requiredUnitsPerWeek` and
   `requiredSessionsPerWeek: number | null`, and **`requiredPerUnit` is renamed
   `allowedSessionsPerUnit`.** That rename is not cosmetic: the value is
   `sessionsAvailableInRange ÷ remainingUnits`, i.e. the budget the *current cadence*
   gives each unit, and `pace-summary.tsx:54` renders it as *"to reach the target"* —
   a ceiling presented as a bar to clear. `ScopeStatus` is in `core/pace.ts`, **not**
   the frozen `core/types.ts`, so this is in bounds. Unit tests required (CLAUDE.md:
   any change to `pace` needs them), including the null branch — no prior, no
   checkpoint, rung 2 absent.
2. **`core/types.ts` — PROPOSED, DO NOT EDIT WITHOUT AGREEMENT.**
   `Stage.estimatedSessionsPerUnit: number | null`. This is the one frozen-file change
   in the whole session. If review declines it, rungs 1 and 3 still ship and rung 2
   waits for the first checkpoint — a real loss exactly when the number is most useful.
3. **Migration** — `stages.estimated_sessions_per_unit integer` (nullable). **Number it
   by build order, not by this list**: if D67 ships first (recommended below) this is
   `0004`, not `0003`. If both are built together, one migration carrying both columns
   is fine and preferable. See the migration note at the bottom of this section before
   running `db:generate`.
4. **Sync mapping for the new column** — `db/server/schema.ts`, `LocalStage`,
   `WireStage`, and both halves of `route.ts` (the `stages` put-apply and the `stages`
   pull-select). No Dexie version bump: the field is not indexed.
5. **`goal-form.tsx`** — move target date **out of the scope block** to the goal level;
   it currently sits at line ~423 as a sub-field of "how many chapters". Add the
   optional prior next to the scope count. A date with no scope shows *"14 weeks left"*
   and nothing else.
6. **`goal-detail/pace-summary.tsx`** — render the ladder; state the missing rung in
   words rather than filling it. Rung 2 is a comparison (*"your cadence gives 3/week;
   this needs 4.2"*), never an instruction, never red (D15, D3) — and it **names its
   source** (*"at your estimate of 2/chapter"* vs *"at your measured 6.7, from 3
   checkpoints"*). That attribution is the D57 clause in D65: rung 2 from one checkpoint
   is a point on n = 1 data, and the count stated beside it is what keeps it honest.
   The widening band stays on the projection, not on the rate.
7. **`PRD.md` §6.7** — the `[v1]` line *"Scope-based required line — hours-per-unit
   against a target date"* is the mis-named value D65 corrects; replace it with the
   rung ladder. The `[later]` line below it — day-one budget breakdown for **staged**
   goals (D19) — **stays `[later]`**: D65 is the single-stage case, not a promotion of
   that item.

**No column moves to `goals`.** `stages.target_date` stays put — moving it is the
reshape D51 forbids, and D24 needs it per-stage. Every v1 goal has one implicit stage,
so the goal's date *is* that row today; under multi-stage it becomes the final stage's
authored date with earlier ones derived backwards via the existing `deadline_derived`
flag. **D56 is unaffected** — its checkpoint gate already requires both scope and date.

### D66 — the hierarchy: no third level, and no subjects table

Settles the axis and **builds nothing.** "GATE → subjects → chapters" mixes sequential
phases (stages — already modelled), parallel divisions (subjects — not modelled and not
to be), and a count that is not a container at all (chapters — already
`scopeUnitLabel`/`scopeUnitTotal`).

Subjects are refused on D12 (a subject level is per-item content tracking wearing a
container), D27 (its only real payoff is scope-cut advice, which is declined
*"entirely"*), and shape (parallel stages contradict `sortOrder` + `state`, which encode
one-at-a-time, and D24's backwards chain). The two supported expressions both already
work: **one goal per subject** when the protocols genuinely differ — which does *not*
explode, since D60's cap is `(date, daypart)` so subjects rotate in by staleness; the
honest cost is N list entries and no single scope number — or **chapters as scope units
across the whole goal**, which is the default.

**One thing to carry forward, or it gets rediscovered as a bug:** `layout.ts` filters
`stages.filter(s => s.state === "active")` and *nothing enforces one active stage per
goal.* Two active stages on one goal schedule in parallel today. D18/D23's sequential
semantics are recorded, not enforced. Whoever builds the multi-stage UI owns that
invariant, and it belongs in `layoutWeek` or the stage-advance mutation — not in a form.

Multi-stage stays `[later]` (PRD §6.3). D66 does not promote it; it fixes the shape it
will have so the next reader of "GATE → subjects → chapters" does not start over.

### D67 — configurable week start. Small, except for one thing

The small part: `isoWeekStart(date, weekStartsOn)` with the day as a **required**
parameter (a `"mon"` default would let call sites go unconverted and still compile).
**Six call sites** — one more than when this was first scoped, because D60 added
`getDaypartCapacity`:

| File | Site |
|---|---|
| `core/pace.ts:23` | `cadenceStatus` — **the only file inside `core/` that gains an argument** |
| `features/plan/planner.ts:99` | `relayoutWeek` default `weekStart` |
| `features/plan/planner.ts:224` | `reconcileNow` |
| `db/local/queries.ts:152` | `getDaypartCapacity` (added by D60) |
| `features/checkin/lib.ts:90` | voluntary-catch-up candidates |
| `features/checkin/lib.ts:275` | `currentWeekStart` |

`core/score.ts` is already clean — it takes `windowStart`/`windowEnd` as parameters. D42
purity is untouched: this is a parameter, not a clock read. Non-core callers read the
value through a new bounded `getWeekStartsOn()` in `db/local/queries.ts` (one row).

**The not-small part: week start forks the plan.** `plan_weeks.id` is
`week-<weekStart>` (D58) and D45 makes the week the atomic sync unit, so two devices
disagreeing produce **two week rows, neither of which loses an LWW race**, each device
reading its own. Consequences, all mandatory:

- **Home: `users.week_starts_on`, nullable, synced.** Additive under D51. `Weekday` is
  already in the frozen types, so **item 3 needs no `core/types.ts` change.** The
  column alone is not enough and the omission is the failure mode this decision is
  about — an implementer who adds it without the plumbing gets a setting that does not
  sync, which *is* the fork. Full list: migration (`0003` if D67 ships first),
  `db/server/schema.ts`, `LocalUser`, `WireUser`, both halves of `route.ts` (the `users`
  put-apply and the `users` pull-select), **`putUser`'s signature** — it takes
  `{ id, email }` today — a settings mutation to write it, and `getWeekStartsOn()` in
  `queries.ts` to read it. No Dexie version bump: not indexed.
- **`applyPull` must count it.** `sync/pull.ts:100` is
  `inputsChanged: dayparts + goals + stages > 0`, and `users` is applied on line 78,
  deliberately outside that count. Left alone, a *pulled* week-start change re-keys the
  week without re-planning: Today reads the new id, finds nothing, goes blank, reports
  nothing — D62's bug shape exactly. Loop-safe by D62's own test: `applyMutable` counts
  only rows it wrote, and relayout never writes `users`.
- **Changing it locally re-lays out immediately**, like a daypart edit (D44).

Three one-time costs, accepted: the cadence window shifts once (a Sunday session may
move in or out of "this week" — a recompute reported calmly, D15, and no logged fact is
touched); the remaining week reshuffles once (`layoutWeek` filters `existing` by
`slot.weekStart === weekStart`, so nothing is retained and D32 has nothing to prefer);
and the old `plan_weeks` row is **orphaned and left**. Verified: `replacePlanWeek` only
touches the named week, nothing derives the old id afterwards, and
`route.ts:applyDelete` acks `planWeeks` without acting — a delete path would be a change
to D45's atomic-week model to reclaim one inert row.

**`PRD.md` §6.8** gains a week-start bullet alongside daypart boundaries and the
per-daypart cap, in the same change (D63's precedent: docs move with the code).

**Default is Monday, not first-open day — declined for a concrete reason.**
`seedIfEmpty` runs on first paint before any pull can arrive and writes `local-user`
through `putUser`, which enqueues. A second device therefore seeds *its* first-open
weekday, wins LWW by being later, and silently re-cuts the week on the first device —
the exact fork D67 exists to prevent, arriving through the door marked convenience.
There is no race-free way to seed a user-scoped default offline-first. `null` means
Monday; the picker is one tap. **Flagged for review** — this is the one place the plan
declines the ask as literally stated.

### Migration note for whoever runs `db:generate`

`0002` is **hand-edited** and regenerating it blindly reintroduces a silent failure
(D58, and the Pre-Wave-3 section above). It is safe to generate anything **after** it —
`0003`, `0004`, or one migration carrying both new columns — **only** because
`drizzle/meta/0002_snapshot.json` already carries the post-edit types — verified this
session: `users.id`, `dayparts.id`/`user_id`, `plan_weeks.id`/`user_id`,
`plan_slots.id`/`plan_week_id`/`daypart_id` are all `text`, and
`stages.eligible_dayparts` is `text[]`. So a diff against it emits only `ADD COLUMN`.
Still: **read the generated SQL before applying** (it must contain nothing but the two
`ALTER TABLE ... ADD COLUMN`s), and **check `drizzle.__drizzle_migrations` afterwards** —
`db:migrate` can print success and exit 0 having done nothing.

### Suggested sequencing

D67 first — it is self-contained, it is the one with a live correctness bug behind it
(the two-device plan fork), and it touches `pace.ts` in a way D65 also does. Then D65,
which is the largest and the most user-visible. D66 is already complete as a decision
and unblocks nothing until multi-stage is scheduled.

`core/types.ts` needs **one** proposed change across all three (D65's prior). D67 and
D66 need none.

---

## W5 — Weekly max stopped overriding the cadence (D64), on `fix/cadence-coherence`

Fixes the "weekly max and min rest days are useless, they totally mismatch" report.
It was real: `layout.ts:98` did `required = Math.min(required, stage.maxPerWeek)`, so
5×/week under a max of 3 planned 3 and said nothing. A max of `0` was storable and
planned nothing at all — the goal disappeared from the plan with no error.

**Decision recorded as D64** (cites D20, D26, D14, D21). The weekly max is a ceiling
on the week's *total* — scheduled plus voluntary catch-up — and never an input to the
plan. Option (a) of the two on the table, taken with teeth rather than as a relabel.

Three code changes, and they only work together:

- **`core/layout.ts`** — the `Math.min` is gone; the plan places the stated cadence.
- **`core/pace.ts`** — `isFeasible` no longer reads `maxPerWeek` either, and lost its
  `doneInWindow` parameter with it. Worth keeping the derivation to hand: the clause
  was `doneInWindow + requiredRemaining > maxPerWeek`, but `requiredRemaining === 0`
  returns true one line above, so every call reaching it has `doneInWindow < required`
  and the sum is *exactly* `required`. It reduced to `required > maxPerWeek` — zero
  information about progress, a config check reported as "not reachable this week".
  The two silent behaviours pointed **opposite ways on the same data**: layout shrank
  the week, pace declared it unreachable. Fixing one alone just moves which surface
  lies.
- **`features/goals/goal-form.tsx`** — refuses a max below the cadence (`weeklyCadence`
  derived the same way `handleSubmit` derives the stored `cadenceCount`, so fixed-days
  can't drift), and the two fields now carry copy saying what they are: *ceilings for
  catch-up, not a second cadence*.

The ceiling is untouched where it belongs — `checkin/lib.ts:voluntaryCandidates`
already withholds a stage once the week's done count reaches it, which is what
Architecture.md §9.3 has said all along. Legacy rows that contradict themselves get a
defined behaviour, not a migration: plan honours the cadence, stale ceiling inerts
catch-up only, next edit of the goal surfaces the error that heals it.

**`minRestDays` deliberately untouched** — it is a real scheduling constraint
(`respectsRest` honours it) and an over-tight gap already shows as `feasible: false`.
**The D60 gap is still open and explicitly restated** in the `isFeasible` docblock and
in D64: `cadenceStatus(stage, history, now)` still can't see the daypart cap, because
that needs the plan and dayparts it doesn't take. Not quietly dropped while editing
the very function the note is about.

### Gates

`lint`, `test`, `build` all clean. **200 tests** (197 baseline − 2 replaced + 5).
Two tests asserted the removed behaviour and were replaced in place, each with a
comment naming what it replaced: `layout.test.ts` "caps total placements at
max_per_week…" and `pace.test.ts` "respects maxPerWeek as a hard ceiling on
feasibility…". The three new failing-first tests were confirmed red on the base
commit before the fix (5-placement, max-of-zero erasure, feasibility) and green after.

**Not browser-verified.** The core change is covered by unit tests, but the form
validation and the new recovery copy have only been type-checked and built — a
click-through of `/goals/new` (set 5×/week + a max of 3, confirm the error; set a
valid max, confirm it saves) is still owed.

**Follow-up in the same branch:** the Weekly max input briefly carried
`min={weeklyCadence}`. Wrong, and worth remembering why — the form has no
`noValidate`, so a native range underflow blocks `submit` before `handleSubmit` runs
and `validate()` never fires. The browser's generic bubble would have replaced D64's
one explanatory sentence on exactly the stored rows the decision exists to explain (an
existing max of 3 under a cadence of 5; a legacy 0). `min` is back to 0 and the message
is `validate()`'s job, which is how the rest of this form already works.
