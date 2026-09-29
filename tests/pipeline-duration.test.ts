import assert from "node:assert/strict";
import test from "node:test";
import { pipelineDurationMs } from "../src/lib/jobs";

test("pipeline duration uses the timestamp captured at scan start", () => {
  const startedAt = 1_000_000;
  assert.equal(pipelineDurationMs(startedAt, startedAt + 90_000), 90_000);
  assert.equal(pipelineDurationMs(0, 10_000), 0);
});
