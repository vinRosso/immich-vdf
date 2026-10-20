import assert from "node:assert/strict";
import test from "node:test";
import { groupShape, pipelineDurationMs } from "../src/lib/jobs";
import type { StoredGroup } from "../src/lib/types";

test("pipeline duration uses the timestamp captured at scan start", () => {
  const startedAt = 1_000_000;
  assert.equal(pipelineDurationMs(startedAt, startedAt + 90_000), 90_000);
  assert.equal(pipelineDurationMs(0, 10_000), 0);
});

test("the group shape changes when a stack is made, not only when files come or go", () => {
  const item = (path: string, stackId: string | null, stackPrimary: boolean) =>
    ({ path, stackId, stackPrimary }) as unknown as StoredGroup["items"][number];
  const plain = [{ groupId: "g1", items: [item("/a.jpg", null, false), item("/b.jpg", null, false)] }] as StoredGroup[];
  const stacked = [{ groupId: "g1", items: [item("/a.jpg", "s1", true), item("/b.jpg", "s1", false)] }] as StoredGroup[];
  assert.equal(groupShape(plain), groupShape(structuredClone(plain)));
  assert.notEqual(groupShape(plain), groupShape(stacked));
  assert.notEqual(groupShape(plain), groupShape([{ ...plain[0]!, items: [plain[0]!.items[0]!] }]));
});
