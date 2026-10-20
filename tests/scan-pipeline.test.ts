import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

let root = "";
let mediaDir = "";
let dataDir = "";

type Modules = {
  jobs: typeof import("../src/lib/jobs");
  store: typeof import("../src/lib/store");
  scan: typeof import("../src/lib/scan");
  inventory: typeof import("../src/lib/scan-inventory");
};
let mods: Modules;

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "vdf-pipeline-"));
  mediaDir = path.join(root, "media");
  dataDir = path.join(root, "data");
  await mkdir(path.join(mediaDir, "trips"), { recursive: true });
  await mkdir(path.join(dataDir, "tmp"), { recursive: true });
  await writeFile(path.join(mediaDir, "trips", "a.mp4"), "video one");
  await writeFile(path.join(mediaDir, "b.mkv"), "video two");
  process.env.DATA_DIR = dataDir;
  process.env.MEDIA_ROOTS = mediaDir;
  // A binary that does not exist: any run that reaches vdf-cli fails to start it.
  process.env.VDF_CLI = path.join(root, "no-such-vdf-cli");
  mods = {
    jobs: await import("../src/lib/jobs"),
    store: await import("../src/lib/store"),
    scan: await import("../src/lib/scan"),
    inventory: await import("../src/lib/scan-inventory"),
  };
  const settings = await mods.store.loadSettings();
  settings.server.scan.includes = [mediaDir];
  settings.server.scan.includeImages = false;
  await mods.store.saveSettings(settings);
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function runToEnd(): Promise<void> {
  const started = await mods.jobs.startScan("server", "manual");
  assert.deepEqual(started, { ok: true });
  assert.equal(await mods.scan.getScan().waitForIdle(20_000), true);
}

test("a vdf-cli that cannot start ends the run with an error and frees the scan lock", async () => {
  await runToEnd();
  const run = (await mods.store.loadRuns()).server;
  assert.equal(run.status, "error");
  assert.match(run.error ?? "", /could not be started/);
  assert.equal(mods.scan.getScan().running, false);
  assert.ok(run.phases && "Inventory" in run.phases);
  // The lock is free again, so the next scan is accepted rather than refused with a 409.
  await runToEnd();
});

test("saved results that cannot be read do not leave the scan locked", async () => {
  await mkdir(path.join(dataDir, "results"), { recursive: true });
  await writeFile(path.join(dataDir, "results", "server.json"), "{not json");
  try {
    await runToEnd();
    const run = (await mods.store.loadRuns()).server;
    assert.equal(run.status, "error");
    assert.match(run.error ?? "", /JSON/i);
    assert.equal(mods.scan.getScan().running, false);
  } finally {
    await rm(path.join(dataDir, "results", "server.json"), { force: true });
  }
});

test("an unchanged library is reused without starting vdf-cli", async () => {
  const settings = await mods.store.loadSettings();
  const scan = settings.server.scan;
  const inventory = await mods.inventory.walkScanInventory([mediaDir], [path.join(mediaDir, ".vdf-trash")], {
    includeImages: scan.includeImages,
  });
  assert.equal(inventory.length, 2);
  const inventoryFp = mods.inventory.fingerprintInventory(inventory);
  const settingsFp = mods.inventory.fingerprintMatchingSettings(scan);
  await mods.store.saveStoredInventory("server", inventory);
  await mods.store.saveResults("server", {
    finishedAt: "2020-01-01T00:00:00.000Z",
    error: null,
    warning: null,
    groups: [],
    compareFingerprint: mods.inventory.combinedCompareFingerprint(inventoryFp, settingsFp, scan.timeWindowDays),
    compareInventoryFingerprint: inventoryFp,
    compareSettingsFingerprint: settingsFp,
    compareTimeWindowDays: scan.timeWindowDays,
    appliedPrefixSeconds: scan.prefixSeconds,
  });
  await runToEnd();
  const run = (await mods.store.loadRuns()).server;
  assert.equal(run.error, null);
  assert.equal(run.status, "ok");
  assert.ok(run.phases && !("CLI scan" in run.phases), "vdf-cli scan must not run");
  assert.ok(mods.scan.getScan().lines.some((line) => /reusing last compare/i.test(line)));
});

test("a new file brings the CLI steps back", async () => {
  await writeFile(path.join(mediaDir, "c.mp4"), "video three");
  await runToEnd();
  const run = (await mods.store.loadRuns()).server;
  assert.equal(run.status, "error");
  assert.ok(run.phases && "CLI scan" in run.phases);
  assert.match(run.error ?? "", /could not be started/);
});

test("capture dates that cannot be read do not stop the scan", async () => {
  const settings = await mods.store.loadSettings();
  settings.server.scan.timeWindowDays = 7;
  await mods.store.saveSettings(settings);
  try {
    await runToEnd();
    const run = (await mods.store.loadRuns()).server;
    // Reading dates fails because there is no vdf-cli, and the scan carries on to the step that needs it.
    assert.equal(run.status, "error");
    assert.match(run.error ?? "", /could not be started/);
    assert.ok(run.phases && "Capture dates" in run.phases);
    assert.ok(run.phases && "CLI scan" in run.phases);
    assert.ok(mods.scan.getScan().lines.some((line) => /Could not read capture dates from files/.test(line)));
    assert.equal(mods.scan.getScan().running, false);
  } finally {
    const restored = await mods.store.loadSettings();
    restored.server.scan.timeWindowDays = 0;
    await mods.store.saveSettings(restored);
  }
});
