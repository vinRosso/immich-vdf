import assert from "node:assert/strict";
import test from "node:test";
import { buildVdfCompareArgs } from "../src/lib/cli-args";
import { decideCompareRun } from "../src/lib/compare-decision";
import { defaultScan, defaultTimeWindowDays } from "../src/lib/scan-defaults";
import { fingerprintInventory, fingerprintMatchingSettings, combinedCompareFingerprint } from "../src/lib/scan-inventory";
import { bufferDays } from "../src/lib/time-window";
import type { StoredResults } from "../src/lib/types";

test("default time window is 0 for Files and 7 for Immich", () => {
  assert.equal(defaultTimeWindowDays("server"), 0);
  assert.equal(defaultTimeWindowDays("immich"), 7);
  assert.equal(defaultScan("server").timeWindowDays, 0);
  assert.equal(defaultScan("immich").timeWindowDays, 7);
});

test("buffer shrinks as the window grows", () => {
  assert.equal(bufferDays(0), 0);
  assert.ok(bufferDays(1) > 0.32 && bufferDays(1) < 0.34);
  assert.ok(bufferDays(365) > 23.5 && bufferDays(365) < 24.5);
  assert.ok(bufferDays(365) / 365 < bufferDays(30) / 30);
});

test("compare args pass the time window", () => {
  const args = buildVdfCompareArgs({
    ...defaultScan(),
    timeWindowDays: 7,
    dbDir: "/data/db/server",
    outputFile: "/data/tmp/out.json",
    settingsFile: "/data/tmp/settings.json",
  });
  assert.equal(args[args.indexOf("--time-window-days") + 1], "7");
});

test("a narrower window still compares, and reuses saved pair scores", () => {
  const scan = defaultScan();
  const inventory = [{ path: "/media/a/one.jpg", sizeBytes: 1, mtimeMs: 1 }];
  const settingsFp = fingerprintMatchingSettings(scan);
  const inventoryFp = fingerprintInventory(inventory);
  const previous: StoredResults = {
    finishedAt: "2020-01-01T00:00:00.000Z",
    error: null,
    warning: null,
    groups: [],
    compareFingerprint: combinedCompareFingerprint(inventoryFp, settingsFp, 30),
    compareSettingsFingerprint: settingsFp,
    compareTimeWindowDays: 30,
  };
  const decision = decideCompareRun({
    scan: { ...scan, timeWindowDays: 7 },
    inventory,
    previous,
    previousInventory: inventory,
  });
  assert.equal(decision.skipCompare, false);
  assert.match(decision.logMessage, /Narrower capture window/i);
});

test("window 0 compares the whole library", () => {
  const scan = { ...defaultScan(), timeWindowDays: 7 };
  const inventory = [{ path: "/media/a/one.jpg", sizeBytes: 1, mtimeMs: 1 }];
  const settingsFp = fingerprintMatchingSettings(scan);
  const inventoryFp = fingerprintInventory(inventory);
  const decision = decideCompareRun({
    scan: { ...scan, timeWindowDays: 0 },
    inventory,
    previous: {
      finishedAt: "2020-01-01T00:00:00.000Z",
      error: null,
      warning: null,
      groups: [],
      compareFingerprint: combinedCompareFingerprint(inventoryFp, settingsFp, 7),
      compareSettingsFingerprint: settingsFp,
      compareTimeWindowDays: 7,
    },
    previousInventory: inventory,
  });
  assert.equal(decision.skipCompare, false);
  assert.match(decision.logMessage, /whole library/i);
});
