import assert from "node:assert/strict";
import test from "node:test";
import { PhaseTimer } from "../src/lib/phase-timer";

test("phase timer logs each step and keeps totals", async () => {
  const lines: string[] = [];
  let clock = 0;
  const timer = new PhaseTimer((line) => lines.push(line), () => clock);
  const value = await timer.time("compare", async () => {
    clock += 12_300;
    return 7;
  });
  await timer.time("compare", async () => {
    clock += 700;
  });
  assert.equal(value, 7);
  assert.deepEqual(lines, ["[scan] compare took 12.3 s", "[scan] compare took 0.7 s"]);
  assert.deepEqual(timer.record(), { compare: 13_000 });
  assert.equal(timer.summary(), "[scan] Timings: compare 13.0 s");
});

test("phase timer records a step that throws", async () => {
  const lines: string[] = [];
  let clock = 0;
  const timer = new PhaseTimer((line) => lines.push(line), () => clock);
  await assert.rejects(
    timer.time("parse", async () => {
      clock += 2_000;
      throw new Error("bad json");
    }),
    /bad json/,
  );
  assert.deepEqual(timer.record(), { parse: 2_000 });
});
