import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredGroup } from "../src/lib/types";
import { UNDO_TTL_MS, rememberTrashUndo, restoreGroups, takeTrashUndo } from "../src/lib/undo";

const group = (groupId: string, count: number): StoredGroup => ({ groupId, items: Array.from({ length: count }, () => ({}) as never) });

test("a trash undo record can be taken once", () => {
  const id = rememberTrashUndo({ finishedAt: "a", moved: [], groups: [] }, 1000);
  assert.ok(takeTrashUndo(id, 2000));
  assert.equal(takeTrashUndo(id, 2000), null);
});

test("a trash undo record expires", () => {
  const id = rememberTrashUndo({ finishedAt: "a", moved: [], groups: [] }, 1000);
  assert.equal(takeTrashUndo(id, 1000 + UNDO_TTL_MS + 1), null);
});

test("a bulk trash keeps one undo record per group", () => {
  const ids = Array.from({ length: 200 }, () => rememberTrashUndo({ finishedAt: "a", moved: [], groups: [] }, 1000));
  assert.ok(ids.every((id) => takeTrashUndo(id, 2000)));
});

test("restoreGroups does not bring back a file that a later action trashed", () => {
  const item = (path: string) => ({ path }) as never;
  const saved: StoredGroup[] = [{ groupId: "g", items: [item("a"), item("b"), item("c")] }];
  const next = restoreGroups([], saved, new Map([["a", "a-restored"]]), new Set(["c"]));
  assert.deepEqual(
    next[0].items.map((entry) => entry.path),
    ["a-restored", "c"],
  );
  assert.deepEqual(restoreGroups([], saved, new Map(), new Set(["c"])), []);
});

test("restoreGroups replaces a surviving group and re-adds a removed one", () => {
  const current = [group("a", 1), group("b", 2)];
  const saved = [group("a", 3), group("c", 2)];
  const next = restoreGroups(current, saved);
  assert.deepEqual(next.map((entry) => [entry.groupId, entry.items.length]), [["a", 3], ["b", 2], ["c", 2]]);
});
