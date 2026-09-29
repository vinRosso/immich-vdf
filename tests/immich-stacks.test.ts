import assert from "node:assert/strict";
import test from "node:test";
import {
  applyChangedStackMembership,
  applyStackMembership,
  assignSelectionToStack,
  groupIsOneCompleteStack,
  orderGroupItems,
} from "../src/lib/immich-stacks";
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

test("a group that is exactly one stack is hidden", () => {
  const stacked = group("g", [
    item("/mnt/a.jpg", "a", { stackId: "s", stackPrimary: true }),
    item("/mnt/b.jpg", "b", { stackId: "s" }),
  ]);
  assert.equal(groupIsOneCompleteStack(stacked), true);
  const loose = group("g", [item("/mnt/a.jpg", "a", { stackId: "s", stackPrimary: true }), item("/mnt/c.jpg", "c")]);
  assert.equal(groupIsOneCompleteStack(loose), false);
  const unmatched = group("g", [
    item("/mnt/a.jpg", "a", { stackId: "s", stackPrimary: true }),
    item("/mnt/b.jpg", "b", { stackId: "s" }),
    item("/mnt/c.jpg", null),
  ]);
  assert.equal(groupIsOneCompleteStack(unmatched), false);
});

test("missing stack members are inserted and groups that share one are merged", () => {
  const stacks = [
    {
      id: "s",
      primaryAssetId: "a",
      assets: [
        { id: "a", originalPath: "/data/a.jpg" },
        { id: "b", originalPath: "/data/b.jpg" },
        { id: "f", originalPath: "/data/f.jpg" },
      ],
    },
    {
      id: "t",
      primaryAssetId: "y",
      assets: [
        { id: "y", originalPath: "/data/y.jpg" },
        { id: "g", originalPath: "/data/g.jpg" },
      ],
    },
  ];
  const applied = applyStackMembership(
    [
      group("ga", [item("/mnt/a.jpg", "a"), item("/mnt/x.jpg", "x")]),
      group("gb", [item("/mnt/f.jpg", "f"), item("/mnt/y.jpg", "y")]),
    ],
    stacks,
    maps,
  );
  assert.equal(applied.length, 1);
  const paths = applied[0].items.map((entry) => entry.path).sort();
  assert.deepEqual(paths, ["/mnt/a.jpg", "/mnt/b.jpg", "/mnt/f.jpg", "/mnt/g.jpg", "/mnt/x.jpg", "/mnt/y.jpg"].sort());
  const primary = applied[0].items.find((entry) => entry.assetId === "a");
  assert.equal(primary?.stackPrimary, true);
  assert.equal(Number.isFinite(applied[0].items.find((entry) => entry.assetId === "b")?.similarity), false);
});

test("groups that share a stack merge even when their paths use different slashes", () => {
  const applied = applyChangedStackMembership(
    [
      group("ga", [item("/god\\storage\\a.jpg", "a")]),
      group("gb", [item("/god/storage/b.jpg", "b")]),
    ],
    [
      {
        id: "new",
        primaryAssetId: "a",
        assets: [
          { id: "a", originalPath: "/data/a.jpg" },
          { id: "b", originalPath: "/data/b.jpg" },
        ],
      },
    ],
    [],
    [],
  );
  assert.equal(applied.length, 1);
  assert.equal(applied[0].items.find((file) => file.assetId === "b")?.stackId, "new");
});

test("a newer stack merges separate groups and an unstacked asset is cleared", () => {
  const applied = applyChangedStackMembership(
    [
      group("ga", [item("/mnt/a.jpg", "a", { stackId: "old", stackPrimary: true }), item("/mnt/b.jpg", "b", { stackId: "old" })]),
      group("gb", [item("/mnt/c.jpg", "c")]),
    ],
    [{ id: "new", primaryAssetId: "b", assets: [{ id: "b", originalPath: "/data/b.jpg" }, { id: "c", originalPath: "/data/c.jpg" }] }],
    maps,
    ["a"],
  );
  assert.equal(applied.length, 1);
  assert.equal(applied[0].items.find((file) => file.assetId === "a")?.stackId, null);
  assert.equal(applied[0].items.find((file) => file.assetId === "b")?.stackId, "new");
  assert.equal(applied[0].items.find((file) => file.assetId === "c")?.stackId, "new");
});

test("stack members sit together with the primary first", () => {
  const ordered = orderGroupItems([
    item("/mnt/loose.jpg", "l"),
    item("/mnt/b.jpg", "b", { stackId: "s" }),
    item("/mnt/a.jpg", "a", { stackId: "s", stackPrimary: true }),
    item("/mnt/d.jpg", "d", { stackId: "t" }),
    item("/mnt/c.jpg", "c", { stackId: "t", stackPrimary: true }),
  ]);
  assert.deepEqual(
    ordered.map((entry) => entry.assetId),
    ["a", "b", "c", "d", "l"],
  );
});

test("stacking a selection keeps every file in the group and peels one-file leftovers loose", () => {
  const next = assignSelectionToStack(
    group("g", [
      item("/mnt/a1.jpg", "a1", { stackId: "sa", stackPrimary: true }),
      item("/mnt/a2.jpg", "a2", { stackId: "sa" }),
      item("/mnt/b1.jpg", "b1", { stackId: "sb", stackPrimary: true }),
      item("/mnt/b2.jpg", "b2", { stackId: "sb" }),
      item("/mnt/b3.jpg", "b3", { stackId: "sb" }),
      item("/mnt/loose.jpg", "l"),
    ]),
    ["a2", "b1"],
    "new",
    "b1",
  );
  assert.equal(next.items.length, 6);
  assert.equal(next.items.find((entry) => entry.assetId === "a2")?.stackId, "new");
  assert.equal(next.items.find((entry) => entry.assetId === "b1")?.stackId, "new");
  assert.equal(next.items.find((entry) => entry.assetId === "a1")?.stackId ?? null, null);
  assert.equal(next.items.find((entry) => entry.assetId === "b2")?.stackId, "sb");
  assert.equal(groupIsOneCompleteStack(next), false);
});

test("stacking loose files leaves an existing stack untouched", () => {
  const next = assignSelectionToStack(
    group("g", [
      item("/mnt/a1.jpg", "a1", { stackId: "sa", stackPrimary: true }),
      item("/mnt/a2.jpg", "a2", { stackId: "sa" }),
      item("/mnt/c.jpg", "c"),
      item("/mnt/d.jpg", "d"),
    ]),
    ["c", "d"],
    "new",
    "c",
  );
  assert.equal(next.items.length, 4);
  assert.equal(next.items.filter((entry) => entry.stackId === "sa").length, 2);
  assert.equal(next.items.filter((entry) => entry.stackId === "new").length, 2);
  assert.equal(groupIsOneCompleteStack(next), false);
});
