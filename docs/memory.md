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

**There is still no usable app.** Wave 1 built the parts, not the product —
there is no goal-creation UI, no check-in screen, no logging. `/` is still the
placeholder and `/styleguide` is the only real page.

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

**Wave 2** — the features that make it an app. Per `Phases.md`:

- **2a — Settings + goals** (`app/settings/`, `app/goals/`, `features/goals/`):
  daypart boundaries, per-daypart caps, goal CRUD, cadence, eligibility,
  time-box, optional scope count, planned vs active with free-slot counts
  visible (D31).
- **2b — Check-in + logging** (`app/page.tsx`, `features/checkin/`): the daily
  loop, and **the first genuinely usable moment**. Depends on all four Wave 1
  tracks, so it is the real integration point.

Second-round Wave 1 work is still outstanding: **D2** (push endpoints +
`pg_cron`) and **D3** (sync-status indicator). Then Wave 3 (sync) and Wave 4
(tracking).

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

`npm run lint`, `npm run test` (62 tests, 6 files) and `npm run build` all pass
on merged `main`. Build compiles the worker: 24 precache entries.

The four `git worktree`s are left in place for Wave 2.

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
- **`@serwist/next` does not work on Next.js 16** — webpack-only, and Turbopack
  is the Next 16 default. Use `@serwist/turbopack`. The worker is a route
  handler, not a bundler plugin, so there is no `public/sw.js`.
- **`esbuild` is only a transitive dependency.** `@serwist/turbopack` needs it
  (optional peer) to compile the worker; it currently resolves via
  vitest → vite → esbuild@0.28.1. If vitest ever goes, declare `esbuild`
  explicitly or the PWA build breaks.
- **`npm run build` is the only check that exercises the service worker.** Lint
  and tests both pass on a tree whose PWA build is broken. Run the build before
  pushing to `main` — it auto-deploys (D40).
