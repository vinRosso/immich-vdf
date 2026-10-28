import assert from "node:assert/strict";
import test from "node:test";
import { applyResultsPatch, patchFits } from "../src/lib/results-patch";
import type { ClientGroup, ResultsResponse } from "../src/lib/types";

const group = (groupId: string, ...paths: string[]): ClientGroup =>
  ({ groupId, items: paths.map((path) => ({ path })) }) as unknown as ClientGroup;

const base: ResultsResponse = {
  section: "server",
  scanned: true,
  finishedAt: null,
  durationMs: null,
  error: null,
  warning: null,
  hiddenIgnored: 0,
  unmatched: 0,
  groups: [group("a", "/1", "/2"), group("b", "/3", "/4"), group("c", "/5", "/6")],
};

test("a patch replaces groups in place, appends new ones and drops removed ones", () => {
  const next = applyResultsPatch(base, {
    finishedAt: null,
    removedIds: ["b"],
    groups: [group("a", "/1", "/2", "/9"), group("d", "/7", "/8")],
    hiddenIgnored: 2,
    unmatched: 1,
  });
  assert.deepEqual(
    next.groups.map((g) => g.groupId),
    ["a", "c", "d"],
  );
  assert.equal(next.groups[0].items.length, 3);
  assert.equal(next.hiddenIgnored, 2);
  assert.equal(next.unmatched, 1);
  assert.equal(base.groups.length, 3);
});

test("a patch from another scan does not fit", () => {
  const patch = { finishedAt: "2026-02-01T00:00:00Z", removedIds: [], groups: [], hiddenIgnored: 0, unmatched: 0 };
  assert.equal(patchFits({ ...base, finishedAt: "2026-01-01T00:00:00Z" }, patch), false);
  assert.equal(patchFits({ ...base, finishedAt: "2026-02-01T00:00:00Z" }, patch), true);
});
