# my-time — Phases

Build order, structured for **parallel Claude Code sessions**. Reads with
[`Architecture.md`](./Architecture.md) §8 for the folder layout.

Two organising rules:

1. **Deploy from commit one** (D40). A live skeleton exists before any feature.
2. **Ownership, not politeness.** Every parallel track owns a disjoint set of paths. Two
   sessions must never need to edit the same file. Where that's unavoidable, the file is
   frozen in Wave 0 instead.

---

## Wave 0 — Foundation *(one session, alone, small)*

Everything else waits on this. It is deliberately tiny, and its real job is not
scaffolding — it is **freezing the shared contracts so parallel work cannot collide.**

- `create-next-app` (TS, App Router, Tailwind) → push → **connect Vercel, deploy `main`**
- Create the Supabase project; record the pooler connection string
- **Install every known dependency up front** — Drizzle, Dexie, Serwist, shadcn, Vitest,
  `web-push`. This exists so no later session touches `package.json` and causes a
  conflict.
- Write `src/core/types.ts` — the shared domain contract, consumed by nearly every track.
  **Frozen after Wave 0**; changes need agreement.
- ESLint with the two invariant guards (`no-restricted-imports`, D42), wired into CI
- `npm run` scripts per `CLAUDE.md`
- Create `docs/memory.md`; commit

**Done when:** a blank page is live on a Vercel URL, `npm run lint` and `npm run test`
both pass, and `core/types.ts` exists.

**Do not** build features, UI, or schema here. Resist it.

---

## Wave 1 — Four parallel tracks

All four start together once Wave 0 lands. Ownership is strict.

### Track A — The scheduler `src/core/`, `tests/core/`

The hardest and most valuable work, and the most isolated — pure TypeScript, no
framework, no database, no React. Runs entirely on unit tests.

- `layout.ts` — rolling-week placement: caps, eligibility, cadence, recovery limits,
  **scarcity-first** ordering (D9), **churn minimisation** via `existing` (D32)
- `reconcile.ts` — daypart packing against stated available minutes; small exact knapsack,
  no partial sessions (D8, D27)
- `score.ts` — cadence debt · deadline pressure · staleness · scarcity
- `pace.ts` — cadence status and scope status; the two on-track answers (D25)
- `explain.ts` — the one-line reason per slot (D14)
- `constants.ts` — **every** tunable coefficient, in one object

Must honour all eight rules in `Architecture.md` §4.2. Owns nothing outside `core/` and
`tests/core/`. **Never imports** `db/`, `app/`, `sync/`, `react`, and never reads the
clock.

*This is the track to give the most capable session.*

### Track B — Data layer `src/db/**`, `drizzle/**`

- Drizzle schema for all eleven tables in `Architecture.md` §5 — **schema-complete now**,
  including tables v1 leaves nearly empty (D29)
- Generate and commit the initial migration; apply to Supabase
- Dexie local schema mirroring it, with the indexes the bounded queries need (D47)
- Local query helpers and the outbox table

Consumes `core/types.ts`, doesn't edit it. No UI, no sync logic.

### Track C — Design system `src/components/ui/**`, `app/styleguide/`, Tailwind config

**Blocked until `docs/design.md` exists** — that's the next thing being written.

- Tokens from `design.md` into the Tailwind theme
- Install the shadcn primitives actually needed
- A `/styleguide` route rendering every token and component — reviewable in the browser,
  on the live deployment

No business logic, no data access.

### Track D — Shell, PWA, push `public/**`, service worker, `app/api/push/**`, `app/api/cron/**`

- `manifest.webmanifest`, icons, Serwist service worker, offline shell caching
- VAPID keypair; `POST /api/push/subscribe`; subscriptions table writes
- `GET /api/cron/remind` — content-free nudge (D37b), shared-secret guarded
- Supabase `pg_cron` job hitting it at daypart boundaries (D37)
- The persistent sync-status indicator **component only** — no sync logic yet (D46)

Verify a real notification arrives on Android before calling it done.

---

## Wave 2 — Features *(needs Wave 1)*

Sequential-ish; two sessions at most.

**2a — Settings + goals** `app/settings/`, `app/goals/`, `features/goals/`
Daypart boundaries with sensible seeded defaults, per-daypart caps, goal CRUD, cadence
(frequency / fixed-days / hybrid), eligibility, time-box, optional scope count, planned
vs active with free-slot counts always visible (D31).

**2b — Check-in + logging** `app/page.tsx`, `features/checkin/`
The daily loop. Detect daypart, state available time, show *required · length · ends at*
(D8), packed list with reasons, one-tap done/skip. Missed sessions die to `/missed` (D20);
voluntary catch-up credited.

## Wave 3 — Sync `src/sync/**`, `app/api/sync/`

Outbox flush, pull, LWW merge, **plan synced atomically per week** (D45). Wire the status
indicator from Track D to real state.

Last because everything works locally without it — and it's the piece most improved by
having real data to sync.

## Wave 4 — Tracking

Required vs actual per goal; the coarse checkpoint prompt (D13). Measured-pace projection
as a **narrowing range** once ~2 weeks of data exist (D17, D25).

## v2 — Deferred, designed

Multi-stage goals · backwards-derived stage deadlines · scope-gap reporting · verdict
cycles · AI behind the provider seam (D39) · auth and multi-user.

---

## Conflict rules for parallel sessions

- **One branch per track.** `main` stays green and deployable at all times.
- Use **`git worktree`** so each session gets its own directory — avoids branch-switching
  collisions on a shared checkout.
- **Frozen after Wave 0:** `package.json`, `core/types.ts`, ESLint config, `npm` scripts.
  Need a change? Say so; don't just edit it.
- **Never touched by Wave 1:** `docs/PRD.md`, `docs/Architecture.md`, `docs/DECISIONS.md`.
  Propose changes, don't make them.
- `docs/memory.md` has **one section per track** — append under your own heading only.
- Merge order: **B → A → C → D**. B defines storage shape, A is largest, C and D are leaves.

## Honest note on parallelism

The real win is **Track A** — it's big, hard, and genuinely isolated. B, C and D are
smaller and partly bounded by review time rather than build time. Four-way parallelism
will not be four times faster, and Wave 0 is a hard serialisation point. Expect the
speed-up to come mostly from A running while everything else proceeds.
