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

### Track D — Shell, PWA, push — **only partly parallel, see §D deps**

`public/**`, `src/sw.ts`, `next.config.ts`, `app/api/push/**`, `app/api/cron/**`

**D1 — parallel now.** `manifest.webmanifest`, icons, Serwist service worker, offline
shell caching, Serwist wired into `next.config.ts`.

**D2 — needs Track B.** VAPID keypair, `POST /api/push/subscribe`, `GET /api/cron/remind`
(content-free nudge, D37b, shared-secret guarded), Supabase `pg_cron` job at daypart
boundaries (D37). All of this writes to and reads from `push_subscriptions`, which is
Track B's schema.

**D3 — needs Track C.** The persistent sync-status indicator component (D46) — it is a
presentational component and needs design tokens to exist.

Not done until a real notification arrives on an Android phone.

---

## Dependency reality

The four tracks are **not** equally parallel. Honest graph:

| Track | Starts | Blocked by | Notes |
|---|---|---|---|
| **A** — core | immediately | — | Genuinely isolated. Pure TS, tests only. |
| **B** — data | immediately | — | Consumes `core/types.ts`; builds from `Architecture.md` §5. |
| **C** — design | immediately | — | Isolated, but **gates `layout.tsx`** — start it early. |
| **D1** — PWA shell | immediately | — | Must not touch `layout.tsx` (see below). |
| **D2** — push | after **B** | `push_subscriptions` table | Endpoints read/write B's schema. |
| **D3** — sync indicator | after **C** | design tokens | Presentational only. |

### The A ↔ B coupling

Both consume `core/types.ts`, frozen in Wave 0. But **A is the only track writing real
logic, so A is the one that will discover gaps** — a field the scheduler needs that the
type doesn't have. B will already have built a schema against the frozen version.

Asymmetric: **A discovers, B follows.** Cheap to absorb, because the database is empty and
regenerating a migration costs nothing — provided A **reports type gaps immediately**
rather than at the end. B should not treat its migration as final until A's types settle.

### Contested files — assign ownership, don't coordinate

These are the collisions that would otherwise happen:

| File | Owner | Why it's contested |
|---|---|---|
| `src/app/layout.tsx` | **C** | C wants fonts + theme provider + no-flash script; D wants SW registration + manifest link. **D hands C a snippet; D never edits it.** |
| `src/app/globals.css` | **C** | Tokens and base styles. Nobody else. |
| `tailwind.config` / `components.json` | **C** | shadcn + theme. |
| `src/lib/utils.ts` | **C** | shadcn's `cn()`. |
| `next.config.ts` | **D1** | Serwist plugin wraps it. |
| `.env.example` | anyone, **append only** | B adds the DB URL, D adds VAPID keys. Additive, trivially merged. |
| `package.json` | frozen in Wave 0 | `npx shadcn add` mutates it — C should install **every** primitive it expects in one pass. Conflicts here are additive and easy, but avoidable. |

### Revised guidance

- **A, B, C start together.** These three are the real parallelism.
- **D1 can join**, provided it stays out of `layout.tsx`.
- **D2 and D3 are second-round work**, not first-round.
- Start **C early** rather than treating it as cosmetic — it gates `layout.tsx`, which
  everything eventually touches.

---

## Wave 2 — Features *(needs Wave 1)*

> **Revised after Wave 1 merged.** This section originally read *"sequential-ish; two
> sessions at most."* That was wrong, and only visibly wrong once the four Wave 1 tracks
> were in one tree: 2a and 2b both needed a shared layer that neither owned and that no
> Wave 1 track had built — domain writes, daypart boundary math, and the `core/` ⇄ Dexie
> seam. Wave 2 is therefore **2.0 plus four**, not two.

### Wave 2.0 — Foundation *(one session, alone, small)* ✅ done

The same role Wave 0 played: freeze contracts so parallel work cannot collide. Wave 1
merged four disconnected pieces; this is what connects them.

- `src/lib/daypart.ts` — boundary math, `now` always a parameter, night wraps midnight
- `src/db/local/mutations.ts` — domain writes, each one transaction: row **and** outbox
  row, never separable. **Ownership of `src/db/local/` passes from Track B to here.**
- `src/features/plan/planner.ts` — the only module bridging pure `core/` and Dexie. Owns
  the plan's outbox granularity and `LocalPlanWeek.version` — merge semantics (D45), not
  a UI concern
- `src/db/local/seed.ts` — first-run dayparts, so `layoutWeek` has somewhere to place
- `src/components/nav.tsx` + `src/app/layout.tsx` — **`layout.tsx` ownership passes from
  Track C to here**
- Every read query the UI tracks will need, added up front, so no later session edits
  `queries.ts`

### Then four in parallel

| Track | Paths | Depends on |
|---|---|---|
| **2a — Settings + goals** | `app/settings/`, `app/goals/**`, `features/goals\|settings/` | 2.0 |
| **2b — Check-in + logging** | `app/page.tsx`, `app/missed/`, `features/checkin/` | 2.0 |
| **2c — Push (D2)** | `app/api/push/**`, `app/api/cron/**`, `lib/push.ts` | Wave 1 only |
| **2d — Sync status (D3)** ✅ | `components/sync-status.tsx`, `hooks/use-sync-status.ts` | Wave 1 only |

**2c and 2d never needed 2.0** — push needs Track B's schema and the indicator needs
`getOutboxDepth()` plus design tokens, all merged in Wave 1. They run alongside it.

**2a — Settings + goals.** Daypart boundaries, per-daypart caps, goal CRUD, cadence
(frequency / fixed-days / hybrid), eligibility, time-box, optional scope count, planned vs
active with free-slot counts always visible (D31). Also wires daypart-driven `auto` theme,
which Track C shipped as an unwired stub.

**2b — Check-in + logging.** The daily loop, and the first genuinely usable moment. Detect
daypart, state available time, show *required · length · ends at* (D8), packed list with
reasons, one-tap done/skip. Missed sessions die to `/missed` (D20); voluntary catch-up
credited.

`/plan` (the week view) is **not v1**. Architecture §8 lists the route, but PRD §6 tags no
week-view screen `[v1]` — §6.4 requires layout to *run*, not to have a screen.

### The handoff that must not be assigned

A component one track builds and another mounts is the failure Wave 1 actually hit: Track
D1 was to hand Track C a `layout.tsx` snippet, neither did it, and the merged app shipped
with no manifest link and no service-worker registration until the supervisor added them.
**Cross-track mounts are the supervisor's job at merge time, not a track's.** Wave 2d built
`<SyncStatus />` and the supervisor mounted it in `nav.tsx`; that is the pattern.

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
- **One `git worktree` per track, at a FRESH PATH. Never reuse another track's
  directory — not even a finished one.** A worktree already checked out to someone
  else's branch is indistinguishable, from inside a new session, from a worktree
  someone is still working in. The correct thing for that session to do is refuse, and
  it will. Cost of a fresh path: one command. Cost of reuse: a session that stops and
  asks, or worse, one that guesses.

  ```
  git worktree add D:/repos/my-time-<track> -b track/<name> origin/main
  ```

  Delete a worktree when its branch is merged (`git worktree remove <path>`), so the
  next wave never has to reason about whether a stale directory is live.
- **Frozen after Wave 0:** `package.json`, `core/types.ts`, ESLint config, `npm` scripts.
  Need a change? Say so; don't just edit it.
- **Never touched by Wave 1:** `docs/PRD.md`, `docs/Architecture.md`, `docs/DECISIONS.md`.
  Propose changes, don't make them.
- `docs/memory.md` has **one section per track** — append under your own heading only.
- Merge order: **B → A → C → D**. B defines storage shape, A is largest, C and D are leaves.

## Honest note on parallelism

Real concurrency here is **three-and-a-bit, not four.** A, B, C and D1 run together; D2
waits on B, D3 waits on C.

The genuine win is **Track A** — big, hard, and the only track with no dependency in
either direction. B and C are moderate. D1 is small. Wave 0 is a hard serialisation
point, and merge review is a second one.

Expect the speed-up to come mostly from A running long while the others complete around
it — not from a four-times multiplier.

**What actually happened, for calibrating the next wave.** Wave 1's four tracks merged with
**zero file conflicts** — path ownership worked exactly as designed, and `core/types.ts`
came through untouched. Every problem was at the *seams*, which no track owns:

- `@serwist/next` turned out incompatible with Next.js 16, so the merged tree did not build
  at all. Neither lint nor tests caught it.
- The D1 → C `layout.tsx` handoff simply never happened.
- The manifest and the viewport disagreed on `theme_color`.
- The first green-locally build **failed on Vercel**, because `useNativeEsbuild` defaults
  differently off Windows.

So: **the serialisation points are where the cost is, and integration is real work, not a
formality.** Budget for it. Two rules came out of this and are worth keeping:

1. **`npm run build` is a mandatory stop condition for every track.** Lint and tests both
   passed on a tree whose PWA build was broken.
2. **No track pushes to `main`.** Tracks commit on their branch; the supervisor merges,
   integrates, verifies the deploy. Otherwise every session burns a deploy cycle
   rediscovering the same integration bug.
