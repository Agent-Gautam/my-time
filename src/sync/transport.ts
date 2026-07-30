// The only place in `src/sync/**` that calls `fetch`.
//
// It is an injectable function type, not a hardwired call, and that is load-bearing for
// the tests: the merge rules are the hard part of this track, and they have to be
// testable against a scripted server without a network or a Postgres. `engine.ts` takes
// a `SyncTransport`; production passes `httpTransport`.
//
// The UI still never reaches the network (D33, D42) — it calls into `sync/`, and
// `sync/` calls the route handler. Nothing here imports `db/server/**`.

import type { SyncRequest, SyncResponse } from "./protocol";

export type SyncTransport = (request: SyncRequest) => Promise<SyncResponse>;

export const SYNC_ENDPOINT = "/api/sync";

/** The shared key header. Paired with `SYNC_KEY` on the route handler (D59). */
export const SYNC_KEY_HEADER = "x-sync-key";

/**
 * **This is not authentication, and must not be described as such.**
 *
 * `NEXT_PUBLIC_` means this value is inlined into the JS bundle at build time, and the
 * service worker precaches that bundle — so it is readable by anyone who opens devtools
 * or fetches the script. It raises the bar from "the URL is the whole secret" to "you
 * have to look", which stops crawlers and drive-by `curl` and stops nothing else.
 *
 * Real auth is a device passphrase or a login, and is deliberately still deferred
 * (D59). Until then this is a speed bump with an honest label.
 */
const SYNC_KEY = process.env.NEXT_PUBLIC_SYNC_KEY ?? "";

/** Thrown for anything that leaves the outbox intact and worth retrying. */
export class SyncTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SyncTransportError";
  }

  /**
   * A rejection retrying cannot fix: the key is missing, wrong, or was rotated while
   * this client was still serving a precached bundle carrying the old one. Retrying a
   * 401 forever would drain the battery and wedge the outbox silently, which is a worse
   * failure than the exposure the key exists to reduce.
   */
  get isFatal(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export function httpTransport(endpoint = SYNC_ENDPOINT): SyncTransport {
  return async (request) => {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(SYNC_KEY ? { [SYNC_KEY_HEADER]: SYNC_KEY } : {}),
        },
        body: JSON.stringify(request),
      });
    } catch (error) {
      // Offline, DNS, aborted — indistinguishable here and treated identically:
      // nothing was acked, so nothing was lost.
      throw new SyncTransportError(
        error instanceof Error ? error.message : "network request failed",
      );
    }

    if (!response.ok) {
      throw new SyncTransportError(`sync failed: ${response.status}`, response.status);
    }

    return (await response.json()) as SyncResponse;
  };
}
