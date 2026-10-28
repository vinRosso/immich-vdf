import assert from "node:assert/strict";
import test from "node:test";
import { addGroupEdit, applyGroupEdits, pruneGroupEdits } from "../src/lib/group-edits";
import type { GroupEdit, StoredGroup, StoredItem } from "../src/lib/types";

function item(path: string, extra: Partial<StoredItem> = {}): StoredItem {
  return { path, similarity: 100, ...extra } as StoredItem;
}
function group(groupId: string, ...paths: string[]): StoredGroup {
  return { groupId, items: paths.map((path) => item(path)) };
}
function edit(type: GroupEdit["type"], members: string[], createdAt = "2026-01-01T00:00:00Z"): GroupEdit {
  return { type, members, createdAt };
}
function shape(groups: StoredGroup[]): string[][] {
  return groups.map((g) => g.items.map((i) => i.path).sort()).sort();
}

test("a rescan keeps an extract", () => {
  const result = applyGroupEdits("server", [group("g1", "/a", "/b", "/c", "/d")], [edit("extract", ["/a", "/b"])]);
  assert.deepEqual(shape(result.groups), [["/a", "/b"], ["/c", "/d"]]);
  assert.match(result.groups.find((g) => g.items.some((i) => i.path === "/a"))!.groupId, /^extract-[0-9a-f]{12}$/);
  assert.equal(result.edits.length, 1);
});

test("extract with a member deleted from disk", () => {
  const result = applyGroupEdits("server", [group("g1", "/a", "/b", "/x")], [edit("extract", ["/a", "/b", "/c"])]);
  assert.deepEqual(shape(result.groups), [["/a", "/b"]]);
  assert.equal(result.edits.length, 1);
});

test("extract whose members are gone is pruned", () => {
  const groups = [group("g1", "/a", "/x", "/y")];
  const result = applyGroupEdits("server", groups, [edit("extract", ["/a", "/b"])]);
  assert.deepEqual(result.groups, groups);
  assert.deepEqual(result.edits, []);
});

test("merge target lands in a different group", () => {
  const result = applyGroupEdits(
    "server",
    [group("g1", "/a", "/x"), group("g2", "/c", "/y")],
    [edit("merge", ["/a", "/b", "/c", "/d"])],
  );
  assert.deepEqual(shape(result.groups), [["/a", "/c", "/x", "/y"]]);
  assert.equal(result.groups[0].groupId, "g1");
});

test("replay is idempotent", () => {
  const groups = [group("g1", "/a", "/b", "/c", "/d"), group("g2", "/e", "/f")];
  const edits = [edit("extract", ["/a", "/b"], "2026-01-01T00:00:00Z"), edit("merge", ["/b", "/e"], "2026-01-02T00:00:00Z")];
  const once = applyGroupEdits("server", groups, edits);
  const twice = applyGroupEdits("server", once.groups, edits);
  assert.deepEqual(shape(twice.groups), shape(once.groups));
  assert.deepEqual(twice.edits, once.edits);
});

test("extract then merge back restores one group", () => {
  const edits = [edit("extract", ["/a", "/b"], "2026-01-01T00:00:00Z"), edit("merge", ["/a", "/b", "/c", "/d"], "2026-01-02T00:00:00Z")];
  const result = applyGroupEdits("server", [group("g1", "/a", "/b", "/c", "/d")], edits);
  assert.deepEqual(shape(result.groups), [["/a", "/b", "/c", "/d"]]);
});

test("immich keys use asset ids", () => {
  const groups: StoredGroup[] = [
    { groupId: "g1", items: ["a", "b", "c"].map((id) => item(`/lib/${id}.jpg`, { assetId: id })) },
  ];
  const result = applyGroupEdits("immich", groups, [edit("extract", ["asset:a", "asset:b"])]);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].items.map((i) => i.assetId).sort(), ["a", "b"]);
});

test("extract then merge then a trashed file does not lose the others on replay", () => {
  // Saved result after: extract {a,b}, merge with {h1,h2}, then h1 trashed. The next scan reuses it.
  const edits = [edit("extract", ["/a", "/b"], "2026-01-01T00:00:00Z"), edit("merge", ["/a", "/b", "/h1", "/h2"], "2026-01-02T00:00:00Z")];
  const result = applyGroupEdits("server", [group("g1", "/a", "/b", "/h2")], edits);
  assert.deepEqual(shape(result.groups), [["/a", "/b", "/h2"]]);
});

test("a new merge replaces earlier merges it contains", () => {
  const edits = [edit("merge", ["/a", "/b"], "2026-01-01T00:00:00Z"), edit("merge", ["/x", "/y"], "2026-01-02T00:00:00Z")];
  const next = addGroupEdit(edits, edit("merge", ["/a", "/b", "/c"], "2026-01-03T00:00:00Z"));
  assert.deepEqual(next.map((e) => e.members.join(",")), ["/x,/y", "/a,/b,/c"]);
});

test("pruning drops only the edits the replay found dead, not ones recorded meanwhile", () => {
  const loaded = [edit("extract", ["/a", "/b"], "1"), edit("extract", ["/gone1", "/gone2"], "2")];
  const kept = [loaded[0]];
  const current = [...loaded, edit("merge", ["/n1", "/n2"], "3")];
  const next = pruneGroupEdits(current, loaded, kept);
  assert.deepEqual(next.map((e) => e.createdAt), ["1", "3"]);
});
