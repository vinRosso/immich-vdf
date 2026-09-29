import assert from "node:assert/strict";
import test from "node:test";
import { ScanManager } from "../src/lib/scan";

test("cancel sets flag and succeeds without a child process", () => {
  const scan = new ScanManager();
  assert.equal(scan.tryBegin({ section: "server", trigger: "manual", secrets: [], slotKey: null }), true);
  assert.equal(scan.cancel(), true);
  assert.equal(scan.cancelled, true);
});

test("cancel is ignored when idle", () => {
  const scan = new ScanManager();
  assert.equal(scan.cancel(), false);
  assert.equal(scan.cancelled, false);
});

test("subscribe snapshot includes server startedAt", () => {
  const scan = new ScanManager();
  let startedAt = 0;
  scan.subscribe((event) => {
    if (event.event === "snapshot") startedAt = event.startedAt;
  });
  assert.equal(startedAt, 0);
  scan.tryBegin({ section: "immich", trigger: "manual", secrets: [], slotKey: null });
  assert.ok(startedAt > 0);
  assert.equal(startedAt, scan.startedAt);
});
