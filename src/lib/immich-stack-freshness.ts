import path from "node:path";
import { loadConfig } from "./config";
import { exclusive, readJson, writeJson } from "./json-file";

/** Ignore Immich timestamps that are only this close to the cached one. */
export const STACK_UPDATE_SLACK_MS = 1_000;

/** Skip another Immich update search when the last one was this recent. */
export const STACK_POLL_INTERVAL_MS = 15_000;

/** First check after a scan replaces results. The scan does not copy Immich stacks. */
export const STACK_RESCAN_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export type StackSyncState = {
  syncedThrough: string | null;
  /** `finishedAt` of the results whose stacks were last reconciled. */
  resultsFinishedAt: string | null;
  updatedAtByAsset: Record<string, string>;
};

export function emptyStackSyncState(): StackSyncState {
  return { syncedThrough: null, resultsFinishedAt: null, updatedAtByAsset: {} };
}

export function normalizeStackSyncState(state: Partial<StackSyncState> | null | undefined): StackSyncState {
  return {
    syncedThrough: state?.syncedThrough ?? null,
    resultsFinishedAt: state?.resultsFinishedAt ?? null,
    updatedAtByAsset: state?.updatedAtByAsset ?? {},
  };
}

/** True when Immich has modified the asset since the cached timestamp, past the slack. */
export function assetStackIsStale(cachedUpdatedAt: string | null | undefined, immichUpdatedAt: string): boolean {
  const next = Date.parse(immichUpdatedAt);
  if (!Number.isFinite(next)) return false;
  if (!cachedUpdatedAt) return true;
  const previous = Date.parse(cachedUpdatedAt);
  if (!Number.isFinite(previous)) return true;
  return next > previous + STACK_UPDATE_SLACK_MS;
}

/** Remember timestamps for a stack this app just wrote, so the next results load does not fetch it again. */
export function acknowledgeStackUpdates(state: StackSyncState, updates: { id: string; updatedAt: string }[]): StackSyncState {
  const updatedAtByAsset = { ...state.updatedAtByAsset };
  for (const update of updates) {
    const next = Date.parse(update.updatedAt);
    if (!update.id || !Number.isFinite(next)) continue;
    const previous = Date.parse(updatedAtByAsset[update.id] ?? "");
    if (!Number.isFinite(previous) || next >= previous) updatedAtByAsset[update.id] = update.updatedAt;
  }
  return pruneStackSync({ ...state, updatedAtByAsset });
}

/** Drop timestamps the next search can no longer return. */
export function pruneStackSync(state: StackSyncState): StackSyncState {
  const cursor = state.syncedThrough ? Date.parse(state.syncedThrough) : Number.NaN;
  if (!Number.isFinite(cursor)) return state;
  const floor = cursor - STACK_UPDATE_SLACK_MS;
  const updatedAtByAsset: Record<string, string> = {};
  for (const [id, updatedAt] of Object.entries(state.updatedAtByAsset)) {
    const ms = Date.parse(updatedAt);
    if (Number.isFinite(ms) && ms >= floor) updatedAtByAsset[id] = updatedAt;
  }
  return {
    syncedThrough: state.syncedThrough,
    resultsFinishedAt: state.resultsFinishedAt ?? null,
    updatedAtByAsset,
  };
}

/**
 * A new scan throws away saved stack ids. Look back to the previous scan, or one day,
 * so an Immich stack made before that scan is applied again.
 */
export function stackRefreshSince(
  state: StackSyncState,
  finishedAt: string | null,
): { since: string | null; scanReplaced: boolean } {
  const scanReplaced = Boolean(finishedAt) && state.resultsFinishedAt !== finishedAt;
  if (!scanReplaced) return { since: stackSearchSince(state.syncedThrough, finishedAt), scanReplaced: false };
  const previous = state.resultsFinishedAt ? Date.parse(state.resultsFinishedAt) : Number.NaN;
  if (Number.isFinite(previous)) {
    return { since: new Date(previous - STACK_UPDATE_SLACK_MS).toISOString(), scanReplaced: true };
  }
  const finish = finishedAt ? Date.parse(finishedAt) : Number.NaN;
  if (!Number.isFinite(finish)) return { since: null, scanReplaced: true };
  return { since: new Date(finish - STACK_RESCAN_LOOKBACK_MS).toISOString(), scanReplaced: true };
}

/** Lower bound for the Immich `updatedAfter` search. Falls back to the scan finish time. */
export function stackSearchSince(syncedThrough: string | null, finishedAt: string | null): string | null {
  const base = syncedThrough ?? finishedAt;
  if (!base) return null;
  const ms = Date.parse(base);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms - STACK_UPDATE_SLACK_MS).toISOString();
}

function syncFile(): string {
  return path.join(loadConfig().dataDir, "immich-stack-sync.json");
}

export async function loadStackSyncState(): Promise<StackSyncState> {
  return normalizeStackSyncState(await readJson<StackSyncState>(syncFile(), emptyStackSyncState()));
}

export function saveStackSyncState(state: StackSyncState): Promise<void> {
  return exclusive(() => writeJson(syncFile(), state));
}
