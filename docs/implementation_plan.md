# Start Today Feature

Adds a **Start Today** action in Settings that gives the user a clean slate — all progress tracking (session logs, check-ins, plan slots, tasks, checkpoints) is wiped from the local DB and the server, goals and daypart configuration survive untouched, and the scheduler re-lays-out a fresh week from today.

---

## User Review Required

> [!CAUTION]
> This deletes all `sessionLogs`, `checkpoints`, `checkIns`, `tasks`, `planWeeks`, and `planSlots` — both from IndexedDB and from the server via delete ops in the outbox/sync. Goals, stages, dayparts, users, and push subscriptions are **not** touched. This operation is irreversible once synced.

> [!IMPORTANT]
> The app's architecture rule is **no hard deletes via mutations** (D48 — history is append-only). However `Start Today` is an explicit user-requested data purge, not a normal lifecycle event. This warrants the same exception as removing test data — direct `localDb.table.clear()` calls for non-synced partials and a batch of server-side deletes via a new dedicated API route (`/api/reset-tracking`), rather than putting LWW-tombstone rows through the outbox (the outbox was designed for record-level LWW, not bulk purges).

## Open Questions

None.

---

## Proposed Changes

### 1 · Server API Route

#### [NEW] `/api/reset-tracking/route.ts`
- POST handler, authenticated with `SYNC_KEY_HEADER` like `/api/sync`.
- Deletes from Postgres (in FK order): `session_logs`, `checkpoints`, `check_ins`, `tasks`, `plan_slots`, `plan_weeks` — all scoped to the single user `LOCAL_USER_ID`.
- Returns `{ ok: true }`.

---

### 2 · Local DB — `resetTracking` mutation

#### [MODIFY] [mutations.ts](file:///d:/repos/my-time/src/db/local/mutations.ts)
- Add `resetTracking(now: IsoDateTime): Promise<void>`.
- Inside one Dexie `rw` transaction spanning all affected tables:
  - `localDb.sessionLogs.clear()`
  - `localDb.checkpoints.clear()`
  - `localDb.checkIns.clear()`
  - `localDb.tasks.clear()`
  - `localDb.planSlots.clear()`
  - `localDb.planWeeks.clear()`
  - `localDb.outbox.clear()` — any pending outbox ops are now stale; replace with a single outbox entry that triggers the server purge on next sync.
- After the transaction, call the `/api/reset-tracking` route directly (not through the outbox) to purge the server synchronously, then call `relayoutWeek({ now })` to produce a fresh plan.

> [!NOTE]
> Skipping the outbox for this one operation is intentional — a batch delete cannot be expressed as record-level LWW puts/deletes without generating thousands of tombstone rows. The server purge is done immediately by the `resetTracking` call itself.

---

### 3 · Settings UI

#### [NEW] `src/features/settings/start-today.tsx`
- Client component `<StartToday />`.
- Displays a card-style section with:
  - **Heading**: "Start Today"
  - **Description**: concise one-paragraph explanation of what the action does and doesn't do (goals are kept, all progress and schedule resets from today).
  - **Red button** (`variant="destructive"`): "Start Today"
- On button click: opens an `AlertDialog` with:
  - Title: "Reset all tracking?"
  - Body: two-sentence warning — what survives, what is deleted.
  - Actions: "Cancel" (default focus) and "Reset — I understand" (destructive).
- On confirm: calls `resetTracking(localNow())`, then `toast.success("Done. Everything resets from today.")`.
- Loading state on button while async runs.

#### [MODIFY] [settings/page.tsx](file:///d:/repos/my-time/src/app/settings/page.tsx)
- Import `<StartToday />` and render it as a new `<section>` at the bottom of the page, visually separated (e.g., `border-t border-border pt-8`).

---

## Verification Plan

### Automated Tests
- `npm run test` — all 221 Vitest tests must still pass (pure core is untouched).
- `npm run build` — production build must be clean.

### Manual Verification
1. Navigate to Settings → scroll to "Start Today" section.
2. Confirm the button is clearly red and description is visible.
3. Click the button → confirm the `AlertDialog` opens with Cancel focused.
4. Click Cancel → confirm nothing changes.
5. Click the button again → confirm "Reset — I understand" → verify:
   - Toast appears.
   - Today page re-renders with a fresh, empty plan.
   - Goals page still shows all goals.
   - Settings (dayparts, theme) unchanged.
