import assert from "node:assert/strict";
import test from "node:test";
import { sortResultGroups } from "../src/lib/results-sort";

type TestGroup = {
  id: string;
  items: { similarity: number; sizeBytes: number; durationSeconds: number; dateCreatedMs?: number }[];
};

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

test("sortResultGroups orders by newest item date in each group", () => {
  const groups: TestGroup[] = [
    { id: "old", items: [{ similarity: 0, sizeBytes: 0, durationSeconds: 0, dateCreatedMs: 1000 }] },
    {
      id: "new",
      items: [
        { similarity: 0, sizeBytes: 0, durationSeconds: 0, dateCreatedMs: 5000 },
        { similarity: 0, sizeBytes: 0, durationSeconds: 0, dateCreatedMs: 2000 },
      ],
    },
    { id: "mid", items: [{ similarity: 0, sizeBytes: 0, durationSeconds: 0, dateCreatedMs: 3000 }] },
  ];
  const newest = sortResultGroups(groups, "time-desc");
  assert.deepEqual(newest.map((g) => g.id), ["new", "mid", "old"]);
  const oldest = sortResultGroups(groups, "time-asc");
  assert.deepEqual(oldest.map((g) => g.id), ["old", "mid", "new"]);
});
