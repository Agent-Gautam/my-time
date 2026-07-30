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
*not started*

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
