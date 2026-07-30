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

import type { Daypart, IsoDateTime } from "@/core/types";

import { LOCAL_USER_ID } from "../ids";
import { localDb } from "./schema";
import { putDaypart, putUser } from "./mutations";

// Re-exported so existing callers keep working; it is defined in `db/ids.ts`
// alongside the other deterministic ids, because the server needs it too and must
// not import Dexie to get it.
export { LOCAL_USER_ID };

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
 */
export async function seedIfEmpty(now: IsoDateTime): Promise<boolean> {
  return localDb.transaction(
    "rw",
    localDb.users,
    localDb.dayparts,
    localDb.outbox,
    async () => {
      if ((await localDb.dayparts.count()) > 0) return false;

      await putUser({ id: LOCAL_USER_ID, email: null }, now);
      for (const daypart of DEFAULT_DAYPARTS) {
        await putDaypart(daypart, now);
      }
      return true;
    },
  );
}
