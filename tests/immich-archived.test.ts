import assert from "node:assert/strict";
import test from "node:test";
import { applyArchivedIdsToCache } from "../src/lib/immich-asset-index";
import { attachAssets } from "../src/lib/immich-join";
import { groupHasImmichArchived } from "../src/lib/immich-archived";
import { immichAssetArchived } from "../src/lib/immich";
import type { StoredGroup, StoredItem } from "../src/lib/types";

test("immichAssetArchived reads isArchived", () => {
  assert.equal(immichAssetArchived({ isArchived: true }), true);
  assert.equal(immichAssetArchived({ isArchived: false }), false);
  assert.equal(immichAssetArchived({}), false);
});

test("attachAssets copies Immich archive state onto items", () => {
  const item: StoredItem = {
    path: "/library/2024/photo.jpg",
    similarity: 99,
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
    assetId: null,
    originalPath: null,
  };
  const groups: StoredGroup[] = [{ groupId: "g1", items: [item] }];
  const assets = [{ id: "a1", originalPath: "/library/2024/photo.jpg", isArchived: true }];
  const next = attachAssets(groups, assets, []);
  assert.equal(next[0]?.items[0]?.immichArchived, true);
});

test("applyArchivedIdsToCache marks archived asset ids", () => {
  const cache = applyArchivedIdsToCache(
    {
      byPath: {
        "/a.jpg": { id: "archived", stackId: null, stackPrimary: false },
        "/b.jpg": { id: "visible", stackId: null, stackPrimary: false },
      },
    },
    new Set(["archived"]),
  );
  assert.equal(cache.byPath["/a.jpg"] && typeof cache.byPath["/a.jpg"] !== "string" && cache.byPath["/a.jpg"].isArchived, true);
  assert.equal(cache.byPath["/b.jpg"] && typeof cache.byPath["/b.jpg"] !== "string" && cache.byPath["/b.jpg"].isArchived, false);
});

test("groupHasImmichArchived is immich-only", () => {
  const group: StoredGroup = {
    groupId: "g1",
    items: [{ path: "/x", immichArchived: true } as StoredItem],
  };
  assert.equal(groupHasImmichArchived("immich", group), true);
  assert.equal(groupHasImmichArchived("server", group), false);
});
