import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
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

test("stdout and stderr keep separate partial lines", () => {
  const scan = new ScanManager();
  scan.tryBegin({ section: "server", trigger: "manual", secrets: [], slotKey: null });
  const out = new PassThrough();
  const err = new PassThrough();
  scan.attach({ stdout: out, stderr: err } as unknown as ChildProcess);
  out.write("half of an out");
  err.write("Error: bad ");
  out.write("line\n");
  err.write("path\n");
  assert.deepEqual(scan.lines, ["half of an outline", "Error: bad path"]);
  assert.equal(scan.cliTail(), "Error: bad path");
});

test("multibyte characters split across chunks stay intact", () => {
  const scan = new ScanManager();
  scan.tryBegin({ section: "server", trigger: "manual", secrets: [], slotKey: null });
  const err = new PassThrough();
  scan.attach({ stdout: new PassThrough(), stderr: err } as unknown as ChildProcess);
  const bytes = Buffer.from("café.mp4\n", "utf8");
  err.write(bytes.subarray(0, 4));
  err.write(bytes.subarray(4));
  assert.deepEqual(scan.lines, ["café.mp4"]);
});

test("the CLI tail skips progress bars and redacts secrets", () => {
  const scan = new ScanManager();
  scan.tryBegin({ section: "immich", trigger: "manual", secrets: ["s3cret"], slotKey: null });
  const err = new PassThrough();
  scan.attach({ stdout: new PassThrough(), stderr: err } as unknown as ChildProcess);
  err.write("Error: key s3cret rejected\r[ 10%] 1/10 ETA 0m09s a.mp4\r");
  assert.equal(scan.cliTail(), "Error: key [redacted] rejected");
});

test("interrupt cancels a running scan and marks it interrupted", async () => {
  const scan = new ScanManager();
  assert.equal(scan.interrupt(), false);
  scan.tryBegin({ section: "server", trigger: "manual", secrets: [], slotKey: null });
  const idle = scan.waitForIdle(1000);
  assert.equal(scan.interrupt(), true);
  assert.equal(scan.cancelled, true);
  assert.equal(scan.interrupted, true);
  scan.finish(false, "Interrupted", null);
  assert.equal(await idle, true);
});

test("waitForIdle gives up after the timeout", async () => {
  const scan = new ScanManager();
  scan.tryBegin({ section: "server", trigger: "manual", secrets: [], slotKey: null });
  assert.equal(await scan.waitForIdle(20), false);
});
