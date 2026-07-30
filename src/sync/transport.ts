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

/** Thrown for anything that leaves the outbox intact and worth retrying. */
export class SyncTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SyncTransportError";
  }
}

export function httpTransport(endpoint = SYNC_ENDPOINT): SyncTransport {
  return async (request) => {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
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
