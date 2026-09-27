import assert from "node:assert/strict";
import test from "node:test";
import { sortResultGroups } from "../src/lib/results-sort";

type TestGroup = { id: string; items: { similarity: number; sizeBytes: number; durationSeconds: number }[] };

test("sortResultGroups orders by max item similarity descending", () => {
  const groups: TestGroup[] = [
    { id: "low", items: [{ similarity: 80, sizeBytes: 1, durationSeconds: 0 }] },
    { id: "high", items: [{ similarity: 99, sizeBytes: 1, durationSeconds: 0 }] },
    { id: "mid", items: [{ similarity: 92, sizeBytes: 1, durationSeconds: 0 }] },
  ];
  const sorted = sortResultGroups(groups, "similarity-desc");
  assert.deepEqual(sorted.map((g) => g.id), ["high", "mid", "low"]);
});

test("sortResultGroups orders by file count ascending", () => {
  const groups: TestGroup[] = [
    { id: "many", items: [{ similarity: 0, sizeBytes: 0, durationSeconds: 0 }, { similarity: 0, sizeBytes: 0, durationSeconds: 0 }] },
    { id: "one", items: [{ similarity: 0, sizeBytes: 0, durationSeconds: 0 }] },
  ];
  const sorted = sortResultGroups(groups, "files-asc");
  assert.deepEqual(sorted.map((g) => g.id), ["one", "many"]);
});
