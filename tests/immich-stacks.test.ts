import assert from "node:assert/strict";
import test from "node:test";
import {
  applyChangedStackMembership,
  applyStackMembership,
  assignSelectionToStack,
  detachAssetsFromStack,
  dropCompleteStacks,
  groupIsOneCompleteStack,
  stacksTouchingGroups,
  orderGroupItems,
  setStackPrimary,
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

test("search results with no stack id still hide a group Immich has already stacked", () => {
  const groups = [group("g", [item("/mnt/a.jpg", "a"), item("/mnt/b.jpg", "b")])];
  const stacks = [
    {
      id: "s",
      primaryAssetId: "a",
      assets: [
        { id: "a", originalPath: "/data/a.jpg" },
        { id: "b", originalPath: "/data/b.jpg" },
      ],
    },
    {
      id: "other",
      primaryAssetId: "x",
      assets: [
        { id: "x", originalPath: "/data/x.jpg" },
        { id: "y", originalPath: "/data/y.jpg" },
      ],
    },
  ];
  assert.equal(stacksTouchingGroups(groups, stacks).length, 1);
  const next = dropCompleteStacks(applyStackMembership(groups, stacksTouchingGroups(groups, stacks), maps));
  assert.equal(next.length, 0);
});

test("a stack that covers only part of a group stays visible", () => {
  const groups = [group("g", [item("/mnt/a.jpg", "a"), item("/mnt/b.jpg", "b"), item("/mnt/c.jpg", "c")])];
  const stacks = [
    {
      id: "s",
      primaryAssetId: "a",
      assets: [
        { id: "a", originalPath: "/data/a.jpg" },
        { id: "b", originalPath: "/data/b.jpg" },
      ],
    },
  ];
  const next = dropCompleteStacks(applyStackMembership(groups, stacks, maps));
  assert.equal(next.length, 1);
  assert.equal(next[0].items.find((file) => file.assetId === "c")?.stackId ?? null, null);
  assert.equal(next[0].items.find((file) => file.assetId === "a")?.stackId, "s");
});

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

test("a finished stack is dropped and a stack with a loose file stays", () => {
  const kept = dropCompleteStacks([
    group("done", [
      item("/mnt/a.jpg", "a", { stackId: "s", stackPrimary: true }),
      item("/mnt/b.jpg", "b", { stackId: "s" }),
    ]),
    group("open", [item("/mnt/a.jpg", "a", { stackId: "s", stackPrimary: true }), item("/mnt/c.jpg", "c")]),
    group("two", [
      item("/mnt/a.jpg", "a", { stackId: "s", stackPrimary: true }),
      item("/mnt/d.jpg", "d", { stackId: "t", stackPrimary: true }),
    ]),
  ]);
  assert.deepEqual(
    kept.map((entry) => entry.groupId),
    ["open", "two"],
  );
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
    item("/mnt/loose.jpg", "l", { dateCreatedMs: 100 }),
    item("/mnt/b.jpg", "b", { stackId: "s", dateCreatedMs: 300 }),
    item("/mnt/a.jpg", "a", { stackId: "s", stackPrimary: true, dateCreatedMs: 200 }),
    item("/mnt/d.jpg", "d", { stackId: "t", dateCreatedMs: 500 }),
    item("/mnt/c.jpg", "c", { stackId: "t", stackPrimary: true, dateCreatedMs: 400 }),
  ]);
  assert.deepEqual(
    ordered.map((entry) => entry.assetId),
    ["l", "a", "b", "c", "d"],
  );
});

test("loose and stack blocks sort by capture date", () => {
  const ordered = orderGroupItems([
    item("/mnt/stack-new.jpg", "n", { stackId: "s", stackPrimary: true, dateCreatedMs: 500 }),
    item("/mnt/loose-old.jpg", "o", { dateCreatedMs: 100 }),
    item("/mnt/loose-new.jpg", "n2", { dateCreatedMs: 300 }),
    item("/mnt/stack-old.jpg", "so", { stackId: "s", dateCreatedMs: 400 }),
  ]);
  assert.deepEqual(
    ordered.map((entry) => entry.assetId),
    ["o", "n2", "n", "so"],
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

test("removing stack members leaves them loose and keeps a surviving stack", () => {
  const next = detachAssetsFromStack(
    group("g", [
      item("/mnt/a.jpg", "a", { stackId: "s", stackPrimary: true }),
      item("/mnt/b.jpg", "b", { stackId: "s" }),
      item("/mnt/c.jpg", "c", { stackId: "s" }),
      item("/mnt/other.jpg", "o", { stackId: "t", stackPrimary: true }),
      item("/mnt/loose.jpg", "l"),
    ]),
    ["a"],
    { id: "s", primaryAssetId: "b", assetIds: ["b", "c"] },
  );
  assert.equal(next.items.find((entry) => entry.assetId === "a")?.stackId ?? null, null);
  assert.equal(next.items.find((entry) => entry.assetId === "b")?.stackPrimary, true);
  assert.equal(next.items.find((entry) => entry.assetId === "c")?.stackId, "s");
  assert.equal(next.items.find((entry) => entry.assetId === "o")?.stackId, "t");
  assert.deepEqual(
    next.items.map((entry) => entry.assetId),
    ["a", "l", "b", "c", "o"],
  );
});

test("a dissolved stack releases the leftover member too", () => {
  const next = detachAssetsFromStack(
    group("g", [
      item("/mnt/a.jpg", "a", { stackId: "s", stackPrimary: true }),
      item("/mnt/b.jpg", "b", { stackId: "s" }),
    ]),
    ["a"],
    null,
  );
  assert.equal(next.items.every((entry) => entry.stackId == null && !entry.stackPrimary), true);
  assert.equal(groupIsOneCompleteStack(next), false);
});

test("changing the stack cover keeps thumbnail order", () => {
  const next = setStackPrimary(
    group("g", [
      item("/mnt/a.jpg", "a", { stackId: "s", stackPrimary: true }),
      item("/mnt/b.jpg", "b", { stackId: "s" }),
      item("/mnt/c.jpg", "c", { stackId: "s" }),
      item("/mnt/loose.jpg", "l"),
    ]),
    "s",
    "c",
  );
  assert.deepEqual(
    next.items.map((entry) => entry.assetId),
    ["l", "c", "a", "b"],
  );
  assert.equal(next.items.find((entry) => entry.assetId === "c")?.stackPrimary, true);
  assert.equal(next.items.find((entry) => entry.assetId === "a")?.stackPrimary, false);
});
