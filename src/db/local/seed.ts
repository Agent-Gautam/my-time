// First run. With no dayparts, `layoutWeek` has nowhere to put anything and the app
// is inert, so a fresh device gets sensible boundaries rather than an empty settings
// screen it doesn't know it needs to visit.
//
// These are **defaults, not decisions** — every value here is editable in settings,
// which is what makes seeding safe (D7 keeps boundaries user-defined; this just picks
// a starting point). Resolves the "first-run seeding" open question in
// `Architecture.md` §11 / `docs/memory.md`.
//
// Written through `mutations.putDaypart` rather than straight to Dexie, so the seed
// rows queue for sync like any other write. A device that seeds and then goes online
// must not look empty to the server.
//
// **They queue like any other write, but they are not stamped like one (D72).** Their
// `updatedAt` is the epoch, not the clock, so the server's LWW guard refuses them
// wherever a real row already exists. Without that, this file is a data-loss bug: the
// ids are deterministic (D58), so a seed is an *update* of the user's own row, and
// `seedIfEmpty` runs on first paint — before any pull can arrive — on every device
// whose mirror is empty for any reason at all (fresh install, reinstalled PWA, cleared
// or evicted IndexedDB). Stamped with `now`, today's defaults beat last week's real
// settings, get pushed, and come straight back down to every other device.

import type { Daypart, IsoDateTime } from "@/core/types";

import { LOCAL_USER_ID } from "../ids";
import { localDb } from "./schema";
import { putDaypart, putUser } from "./mutations";

// Re-exported so existing callers keep working; it is defined in `db/ids.ts`
// alongside the other deterministic ids, because the server needs it too and must
// not import Dexie to get it.
export { LOCAL_USER_ID };

/**
 * The `updatedAt` every seeded row carries (D72). Deliberately the earliest value the
 * `IsoDateTime` convention can express, so `stored.updatedAt < incoming.updatedAt` is
 * false against *any* real row on either side of the wire. This works because D53 makes
 * the comparison a plain string comparison that both halves of sync agree on.
 */
const SEED_STAMP = "1970-01-01T00:00:00" as IsoDateTime;

/**
 * Morning · afternoon · evening · night, with night wrapping past midnight —
 * the case `lib/daypart.ts` is built around. `activeCap: 2` per daypart (D11).
 */
export const DEFAULT_DAYPARTS: Daypart[] = [
  { id: "daypart-morning", name: "morning", startTime: "05:00", endTime: "12:00", activeCap: 2, sortOrder: 0 },
  { id: "daypart-afternoon", name: "afternoon", startTime: "12:00", endTime: "17:00", activeCap: 2, sortOrder: 1 },
  { id: "daypart-evening", name: "evening", startTime: "17:00", endTime: "21:00", activeCap: 2, sortOrder: 2 },
  { id: "daypart-night", name: "night", startTime: "21:00", endTime: "05:00", activeCap: 2, sortOrder: 3 },
];

/**
 * Seed the device if it has never been seeded. Returns true if it wrote.
 *
 * Idempotent, and safe against concurrent callers: the emptiness check and the
 * writes share one transaction, so two simultaneous calls cannot both decide the
 * table is empty. An existing daypart — even one the user has since edited or
 * a row that arrived from sync — means this is not a fresh device, and nothing
 * is touched.
 *
 * `now` is the moment the rows are *queued*; `SEED_STAMP` is where they sit in the LWW
 * order. See the header for why those must not be the same value.
 */
export async function seedIfEmpty(now: IsoDateTime): Promise<boolean> {
  return localDb.transaction(
    "rw",
    localDb.users,
    localDb.dayparts,
    localDb.outbox,
    async () => {
      if ((await localDb.dayparts.count()) > 0) return false;

      await putUser({ id: LOCAL_USER_ID, email: null }, now, SEED_STAMP);
      for (const daypart of DEFAULT_DAYPARTS) {
        await putDaypart(daypart, now, SEED_STAMP);
      }
      return true;
    },
  );
}
