import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { cliFailure } from "../src/lib/cli-failure";
import { removeStaleScanTemp } from "../src/lib/config";
import { ScanManager } from "../src/lib/scan";

test("cliFailure tells a missing binary from a crash", () => {
  assert.match(cliFailure({ code: null, signal: null, spawnFailed: true }, null), /could not be started/);
  assert.equal(cliFailure({ code: 2, signal: null, spawnFailed: false }, null), "vdf-cli exited with code 2");
  assert.equal(
    cliFailure({ code: 1, signal: null, spawnFailed: false }, "Error: no database"),
    "vdf-cli exited with code 1: Error: no database",
  );
});

test("cliFailure names the signal when the process was killed", () => {
  assert.equal(cliFailure({ code: null, signal: "SIGKILL", spawnFailed: false }, null), "vdf-cli was stopped by SIGKILL");
  assert.equal(
    cliFailure({ code: null, signal: null, spawnFailed: false }, null),
    "vdf-cli stopped without an exit code",
  );
});

test("stale scan temp files are removed and fresh ones kept", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vdf-tmp-"));
  try {
    const old = path.join(dir, "scan-immich-1.json");
    const oldSettings = path.join(dir, "scan-immich-settings-1.json");
    const fresh = path.join(dir, "scan-server-2.json");
    const other = path.join(dir, "notes.json");
    for (const file of [old, oldSettings, fresh, other]) await writeFile(file, "{}");
    const longAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    for (const file of [old, oldSettings, other]) await utimes(file, longAgo, longAgo);
    assert.equal(removeStaleScanTemp(dir), 2);
    assert.deepEqual(readdirSync(dir).sort(), ["notes.json", "scan-server-2.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removing stale temp files tolerates a missing folder", async () => {
  const dir = path.join(tmpdir(), "vdf-missing-tmp-folder");
  await mkdir(path.dirname(dir), { recursive: true });
  assert.equal(removeStaleScanTemp(dir), 0);
});

test("shutDown refuses new scans and resolves once the run ends", async () => {
  const scan = new ScanManager();
  scan.tryBegin({ section: "server", trigger: "manual", secrets: [], slotKey: null });
  const stopped = scan.shutDown();
  assert.equal(scan.interrupted, true);
  assert.equal(scan.closed, true);
  scan.finish(false, "Interrupted by shutdown", null);
  assert.equal(await stopped, true);
  assert.equal(scan.tryBegin({ section: "immich", trigger: "manual", secrets: [], slotKey: null }), false);
});

test("shutDown with no scan running resolves at once", async () => {
  const scan = new ScanManager();
  assert.equal(await scan.shutDown(), true);
});
