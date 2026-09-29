import assert from "node:assert/strict";
import test from "node:test";
import { acknowledgeStackUpdates, assetStackIsStale, emptyStackSyncState, stackRefreshSince, stackSearchSince } from "../src/lib/immich-stack-freshness";

test("an Immich update more than a second after the cache is stale", () => {
  assert.equal(assetStackIsStale(undefined, "2026-09-29T14:12:58.000Z"), true);
  assert.equal(assetStackIsStale("2026-09-29T14:12:58.000Z", "2026-09-29T14:12:58.500Z"), false);
  assert.equal(assetStackIsStale("2026-09-29T14:12:58.000Z", "2026-09-29T14:13:00.000Z"), true);
});

test("a stack written by this app is not stale on the next check", () => {
  const state = acknowledgeStackUpdates(emptyStackSyncState(), [
    { id: "asset-a", updatedAt: "2026-09-29T14:12:58.000Z" },
    { id: "asset-b", updatedAt: "2026-09-29T14:12:58.100Z" },
  ]);
  assert.equal(assetStackIsStale(state.updatedAtByAsset["asset-a"], "2026-09-29T14:12:58.000Z"), false);
  assert.equal(assetStackIsStale(state.updatedAtByAsset["asset-b"], "2026-09-29T14:12:58.100Z"), false);
  assert.equal(assetStackIsStale(state.updatedAtByAsset["asset-a"], "2026-09-29T14:13:05.000Z"), true);
});

test("a new scan looks back across the previous results, and the first one looks back a day", () => {
  const replaced = stackRefreshSince(
    { syncedThrough: "2026-09-29T14:29:00.000Z", resultsFinishedAt: "2026-09-29T14:11:00.000Z", updatedAtByAsset: {} },
    "2026-09-29T14:37:10.000Z",
  );
  assert.equal(replaced.scanReplaced, true);
  assert.equal(replaced.since, "2026-09-29T14:10:59.000Z");

  const first = stackRefreshSince(
    { syncedThrough: "2026-09-29T14:29:00.000Z", resultsFinishedAt: null, updatedAtByAsset: {} },
    "2026-09-29T14:37:10.000Z",
  );
  assert.equal(first.since, "2026-09-28T14:37:10.000Z");
});

test("the update search starts just before the last sync, or the scan finish", () => {
  assert.equal(stackSearchSince("2026-09-29T14:12:58.000Z", "2026-09-29T14:11:00.000Z"), "2026-09-29T14:12:57.000Z");
  assert.equal(stackSearchSince(null, "2026-09-29T14:11:00.000Z"), "2026-09-29T14:10:59.000Z");
  assert.equal(stackSearchSince(null, null), null);
});
