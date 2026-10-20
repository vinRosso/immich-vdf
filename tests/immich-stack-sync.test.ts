import assert from "node:assert/strict";
import test from "node:test";
import { applyListedStacks } from "../src/lib/immich-stack-sync";
import { applyStackMembership, dropCompleteStacks } from "../src/lib/immich-stacks";
import type { StoredGroup, StoredItem } from "../src/lib/types";

const maps = [{ from: "/data", to: "/mnt" }];

function item(path: string, assetId: string | null, extra: Partial<StoredItem> = {}): StoredItem {
  return {
    path,
    similarity: 97,
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
    assetId,
    originalPath: null,
    ...extra,
  };
}

function group(groupId: string, items: StoredItem[]): StoredGroup {
  return { groupId, items };
}

test("list-only apply leaves a stack badge without members when the list does not touch the group", () => {
  const groups = [group("g", [item("/mnt/a.jpg", "a", { stackId: "s", stackPrimary: true }), item("/mnt/x.jpg", "x")])];
  const listed = applyListedStacks(groups, [], maps);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].items.length, 2);
  assert.equal(listed[0].items.find((entry) => entry.assetId === "a")?.stackId, "s");
});

test("fetch-shaped full stack membership inserts every member after a thin list annotate", () => {
  // Simulate a thin GET /stacks list that only knew about asset a, then a full GET /stacks/:id.
  const thin = [
    {
      id: "s",
      primaryAssetId: "a",
      assets: [{ id: "a", originalPath: "/data/a.jpg" }],
    },
  ];
  const full = [
    {
      id: "s",
      primaryAssetId: "a",
      assets: [
        { id: "a", originalPath: "/data/a.jpg" },
        { id: "b", originalPath: "/data/b.jpg" },
        { id: "c", originalPath: "/data/c.jpg" },
      ],
    },
  ];
  const groups = [group("g", [item("/mnt/a.jpg", "a"), item("/mnt/x.jpg", "x")])];
  const annotated = applyStackMembership(groups, thin, maps);
  assert.equal(annotated[0].items.find((entry) => entry.assetId === "a")?.stackId, "s");
  assert.equal(annotated[0].items.some((entry) => entry.assetId === "b"), false);

  const expanded = dropCompleteStacks(applyStackMembership(annotated, full, maps));
  assert.equal(expanded.length, 1);
  assert.deepEqual(
    expanded[0].items.map((entry) => entry.assetId).sort(),
    ["a", "b", "c", "x"],
  );
});
