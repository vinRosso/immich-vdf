import assert from "node:assert/strict";
import test from "node:test";
import { pruneTrashedFromAssetCache } from "../src/lib/immich-asset-index";
import { dropImmichTrashedFromGroups } from "../src/lib/immich-join";
import { immichAssetTrashed } from "../src/lib/immich";
import type { StoredGroup } from "../src/lib/types";

test("immichAssetTrashed reads isTrashed and deletedAt", () => {
  assert.equal(immichAssetTrashed({ isTrashed: true }), true);
  assert.equal(immichAssetTrashed({ deletedAt: "2026-01-01T00:00:00.000Z" }), true);
  assert.equal(immichAssetTrashed({ isTrashed: false }), false);
});

test("dropImmichTrashedFromGroups removes trashed members and singleton groups", () => {
  const groups: StoredGroup[] = [
    {
      groupId: "g1",
      items: [
        { path: "/a.jpg", assetId: "keep", similarity: 1, sizeBytes: 1, durationSeconds: 0, resolution: null, width: 0, height: 0, bitrateKbps: 0, bitDepth: 0, audioBitrateKbps: 0, dateCreatedMs: 0, flags: [], partialClipOffsetSeconds: 0, isImage: true, format: null, fps: 0, originalPath: null, stackId: null, stackPrimary: false },
        { path: "/b.jpg", assetId: "gone", similarity: 1, sizeBytes: 1, durationSeconds: 0, resolution: null, width: 0, height: 0, bitrateKbps: 0, bitDepth: 0, audioBitrateKbps: 0, dateCreatedMs: 0, flags: [], partialClipOffsetSeconds: 0, isImage: true, format: null, fps: 0, originalPath: null, stackId: null, stackPrimary: false },
      ],
    },
  ];
  const next = dropImmichTrashedFromGroups(groups, new Set(["gone"]));
  assert.equal(next.length, 0);
});

test("pruneTrashedFromAssetCache drops entries by asset id", () => {
  const cache = pruneTrashedFromAssetCache(
    { byPath: { "/a.jpg": "gone", "/b.jpg": { id: "keep", stackId: null, stackPrimary: false } } },
    new Set(["gone"]),
  );
  assert.deepEqual(Object.keys(cache.byPath), ["/b.jpg"]);
});
