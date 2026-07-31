// The sync layer's public surface. Note what is *not* here: `syncNow` is deliberately
// left off. It exists in `engine.ts` for the triggers and the tests, but nothing
// outside `sync/` should be able to import a "sync it now" function — there is no sync
// button, and the cheapest way to keep it that way is for the entry point not to offer
// one (D46). What the UI gets is `startSync` and a status to read.

export {
  configureSync,
  getServerSyncEngineSnapshot,
  getSyncEngineSnapshot,
  resetSyncMemo,
  startSync,
  stopSync,
  subscribeSyncEngine,
  type RelayoutAfterPull,
  type SyncEngineState,
  type SyncOutcome,
} from "./engine";

export { httpTransport, SyncTransportError, type SyncTransport } from "./transport";
export type { SyncRequest, SyncResponse } from "./protocol";
