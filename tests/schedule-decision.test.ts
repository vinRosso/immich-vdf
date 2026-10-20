import assert from "node:assert/strict";
import test from "node:test";
import { decideScheduled, slotPatch } from "../src/lib/schedule";
import type { ScheduleSettings } from "../src/lib/types";

const daily: ScheduleSettings = {
  mode: "daily",
  time: "03:00",
  weekday: 0,
  timezone: "UTC",
  scan: undefined,
} as unknown as ScheduleSettings;

const at = (iso: string) => new Date(iso);

test("a due slot starts when nothing is running", () => {
  const decision = decideScheduled(daily, at("2026-10-20T03:02:00Z"), { slotKey: "2026-10-19" }, "idle");
  assert.deepEqual(decision, { action: "start", slot: "2026-10-20" });
});

test("a due slot waits in line behind another scan instead of being skipped", () => {
  const decision = decideScheduled(daily, at("2026-10-20T03:02:00Z"), { slotKey: "2026-10-19" }, "other");
  assert.deepEqual(decision, { action: "queue", slot: "2026-10-20" });

  // Already queued: nothing more to write on the next tick.
  const again = decideScheduled(daily, at("2026-10-20T03:02:20Z"), { slotKey: "2026-10-19", pendingSlot: "2026-10-20" }, "other");
  assert.deepEqual(again, { action: "none" });
});

test("a queued slot starts once the other scan is done, long after its ten minute window", () => {
  const run = { slotKey: "2026-10-19", pendingSlot: "2026-10-20" };
  assert.deepEqual(decideScheduled(daily, at("2026-10-20T05:30:00Z"), run, "other"), { action: "none" });
  assert.deepEqual(decideScheduled(daily, at("2026-10-20T05:30:20Z"), run, "idle"), { action: "start", slot: "2026-10-20" });
});

test("a slot cut short by a restart runs again when the server is back", () => {
  const run = { slotKey: "2026-10-19", pendingSlot: "2026-10-20" };
  assert.deepEqual(decideScheduled(daily, at("2026-10-20T09:00:00Z"), run, "idle"), { action: "start", slot: "2026-10-20" });
});

test("a scheduled scan already running for this section is left alone", () => {
  const run = { slotKey: "2026-10-19", pendingSlot: "2026-10-20" };
  assert.deepEqual(decideScheduled(daily, at("2026-10-20T03:05:00Z"), run, "this-section-scheduled"), { action: "none" });
});

test("a slot older than a day is given up and counted as missed", () => {
  const run = { slotKey: "2026-10-18", pendingSlot: "2026-10-19" };
  const decision = decideScheduled(daily, at("2026-10-20T04:00:00Z"), run, "idle");
  assert.deepEqual(decision, { action: "drop", slot: "2026-10-19", missed: true });
  // Just inside the day it still runs.
  assert.deepEqual(decideScheduled(daily, at("2026-10-20T02:00:00Z"), run, "idle"), { action: "start", slot: "2026-10-19" });
});

test("today's slot replaces an older one that was still waiting", () => {
  const run = { slotKey: "2026-10-18", pendingSlot: "2026-10-19" };
  assert.deepEqual(decideScheduled(daily, at("2026-10-20T03:01:00Z"), run, "idle"), { action: "start", slot: "2026-10-20" });
});

test("a pending slot that already ran, or whose schedule is off, is cleared quietly", () => {
  const done = decideScheduled(daily, at("2026-10-20T09:00:00Z"), { slotKey: "2026-10-20", pendingSlot: "2026-10-20" }, "idle");
  assert.deepEqual(done, { action: "drop", slot: "2026-10-20", missed: false });
  const off = decideScheduled({ ...daily, mode: "off" }, at("2026-10-20T09:00:00Z"), { slotKey: null, pendingSlot: "2026-10-20" }, "idle");
  assert.deepEqual(off, { action: "drop", slot: "2026-10-20", missed: false });
});

test("nothing is due and nothing is waiting", () => {
  assert.deepEqual(decideScheduled(daily, at("2026-10-20T12:00:00Z"), { slotKey: "2026-10-20" }, "idle"), { action: "none" });
  assert.deepEqual(decideScheduled({ ...daily, mode: "off" }, at("2026-10-20T03:01:00Z"), { slotKey: null }, "idle"), { action: "none" });
});

test("the slot is recorded when a scheduled run ends, except when the server cut it short", () => {
  assert.deepEqual(slotPatch("schedule", "2026-10-20", false), { slotKey: "2026-10-20", pendingSlot: null });
  assert.deepEqual(slotPatch("schedule", "2026-10-20", true), {});
  assert.deepEqual(slotPatch("manual", null, false), {});
  assert.deepEqual(slotPatch(null, null, false), {});
});
