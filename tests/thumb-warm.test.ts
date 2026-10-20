import assert from "node:assert/strict";
import test from "node:test";
import { posterWarmOrder } from "../src/lib/thumb-warm";
import type { StoredItem } from "../src/lib/types";

function item(path: string, assetId: string | null = null, stackPrimary = false): StoredItem {
  return {
    path,
    similarity: 100,
    sizeBytes: 1,
    durationSeconds: 0,
    resolution: null,
    width: 0,
    height: 0,
    bitrateKbps: 0,
    bitDepth: 0,
    audioBitrateKbps: 0,
    dateCreatedMs: 0,
    flags: [],
    partialClipOffsetSeconds: 0,
    isImage: true,
    format: null,
    fps: 0,
    assetId,
    originalPath: null,
    stackPrimary,
  };
}

test("poster warm-up renders every group's cover before the other files", () => {
  const groups = [
    { groupId: "a", items: [item("a1"), item("a2", null, true)] },
    { groupId: "b", items: [item("b1"), item("b2")] },
  ];
  assert.deepEqual(posterWarmOrder("server", { groups }), ["a2", "b1", "a1", "b2"]);
});

test("poster warm-up skips Immich assets, whose posters come from the Immich API", () => {
  const groups = [{ groupId: "a", items: [item("a1", "asset-1"), item("a2")] }];
  assert.deepEqual(posterWarmOrder("immich", { groups }), ["a2"]);
  assert.deepEqual(posterWarmOrder("server", { groups }), ["a1", "a2"]);
});
