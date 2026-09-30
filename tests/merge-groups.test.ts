import assert from "node:assert/strict";
import test from "node:test";
import { mergeStoredGroups } from "../src/lib/merge-groups";
import type { StoredGroup, StoredItem } from "../src/lib/types";

function item(path: string, extra: Partial<StoredItem> = {}): StoredItem {
  return {
    path,
    similarity: 90,
    sizeBytes: 10,
    durationSeconds: 0,
    resolution: null,
    width: 1,
    height: 1,
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
    ...extra,
  };
}

function group(groupId: string, paths: string[], extra?: Partial<StoredItem>): StoredGroup {
  return { groupId, items: paths.map((path) => item(path, extra)) };
}

test("mergeStoredGroups keeps the drop target and appends the dragged files", () => {
  const groups = [group("a", ["/a.jpg", "/b.jpg"]), group("b", ["/c.jpg"]), group("c", ["/d.jpg", "/e.jpg"])];
  const merged = mergeStoredGroups(groups, "c", "a");
  assert.deepEqual(
    merged.map((entry) => entry.groupId),
    ["a", "b"],
  );
  assert.deepEqual(
    merged[0].items.map((entry) => entry.path),
    ["/a.jpg", "/b.jpg", "/d.jpg", "/e.jpg"],
  );
});

test("mergeStoredGroups dedupes the same path and keeps a real similarity", () => {
  const groups = [
    group("a", ["/a.jpg"], { similarity: 95, assetId: null }),
    group("b", ["/a.jpg", "/b.jpg"], { similarity: Number.NaN, assetId: "asset-b" }),
  ];
  groups[1].items[0] = item("/a.jpg", { similarity: Number.NaN, assetId: "asset-a" });
  const merged = mergeStoredGroups(groups, "b", "a");
  assert.equal(merged.length, 1);
  assert.equal(merged[0].groupId, "a");
  assert.equal(merged[0].items.length, 2);
  const shared = merged[0].items.find((entry) => entry.path === "/a.jpg");
  assert.equal(shared?.similarity, 95);
  assert.equal(shared?.assetId, "asset-a");
});

test("mergeStoredGroups refuses a drop on the same group", () => {
  assert.throws(() => mergeStoredGroups([group("a", ["/a.jpg", "/b.jpg"])], "a", "a"), /different group/);
});
