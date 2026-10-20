import assert from "node:assert/strict";
import test from "node:test";
import { decideCompareRun } from "../src/lib/compare-decision";
import {
  combinedCompareFingerprint,
  fingerprintInventory,
  fingerprintMatchingSettings,
  type InventoryEntry,
} from "../src/lib/scan-inventory";
import { defaultScan } from "../src/lib/scan-defaults";
import type { StoredResults } from "../src/lib/types";

function stored(overrides: Partial<StoredResults> = {}): StoredResults {
  return {
    finishedAt: "2020-01-01T00:00:00.000Z",
    error: null,
    warning: null,
    groups: [{ groupId: "g1", items: [] }],
    ...overrides,
  };
}

const baseInventory: InventoryEntry[] = [
  { path: "/media/a/one.jpg", sizeBytes: 100, mtimeMs: 1 },
  { path: "/media/a/two.jpg", sizeBytes: 200, mtimeMs: 2 },
];

test("unchanged inventory and settings skip compare", () => {
  const scan = defaultScan();
  const settingsFp = fingerprintMatchingSettings(scan);
  const inventoryFp = fingerprintInventory(baseInventory);
  const combined = combinedCompareFingerprint(inventoryFp, settingsFp);
  const decision = decideCompareRun({
    scan,
    inventory: baseInventory,
    previous: stored({
      compareFingerprint: combined,
      compareInventoryFingerprint: inventoryFp,
      compareSettingsFingerprint: settingsFp,
    }),
    previousInventory: baseInventory,
  });
  assert.equal(decision.skipCompare, true);
  assert.match(decision.logMessage, /reusing last compare/i);
});

test("new path requires compare", () => {
  const scan = defaultScan();
  const settingsFp = fingerprintMatchingSettings(scan);
  const inventoryFp = fingerprintInventory(baseInventory);
  const combined = combinedCompareFingerprint(inventoryFp, settingsFp);
  const next = [...baseInventory, { path: "/media/a/three.jpg", sizeBytes: 50, mtimeMs: 3 }];
  const decision = decideCompareRun({
    scan,
    inventory: next,
    previous: stored({
      compareFingerprint: combined,
      compareInventoryFingerprint: inventoryFp,
      compareSettingsFingerprint: settingsFp,
    }),
    previousInventory: baseInventory,
  });
  assert.equal(decision.skipCompare, false);
  assert.match(decision.logMessage, /1 file changed/i);
});

test("size change requires compare", () => {
  const scan = defaultScan();
  const settingsFp = fingerprintMatchingSettings(scan);
  const inventoryFp = fingerprintInventory(baseInventory);
  const combined = combinedCompareFingerprint(inventoryFp, settingsFp);
  const next = baseInventory.map((entry) =>
    entry.path === "/media/a/one.jpg" ? { ...entry, sizeBytes: 101 } : entry,
  );
  const decision = decideCompareRun({
    scan,
    inventory: next,
    previous: stored({
      compareFingerprint: combined,
      compareInventoryFingerprint: inventoryFp,
      compareSettingsFingerprint: settingsFp,
    }),
    previousInventory: baseInventory,
  });
  assert.equal(decision.skipCompare, false);
  assert.match(decision.logMessage, /1 file changed/i);
});

test("percent change requires compare", () => {
  const scan = defaultScan();
  const settingsFp = fingerprintMatchingSettings(scan);
  const inventoryFp = fingerprintInventory(baseInventory);
  const combined = combinedCompareFingerprint(inventoryFp, settingsFp);
  const decision = decideCompareRun({
    scan: { ...scan, percent: 92 },
    inventory: baseInventory,
    previous: stored({
      compareFingerprint: combined,
      compareInventoryFingerprint: inventoryFp,
      compareSettingsFingerprint: settingsFp,
    }),
    previousInventory: baseInventory,
  });
  assert.equal(decision.skipCompare, false);
  assert.match(decision.logMessage, /Matching settings changed/i);
});

test("AI matching toggled requires compare", () => {
  const scan = defaultScan();
  const settingsFp = fingerprintMatchingSettings(scan);
  const inventoryFp = fingerprintInventory(baseInventory);
  const combined = combinedCompareFingerprint(inventoryFp, settingsFp);
  const decision = decideCompareRun({
    scan: { ...scan, aiMatching: true },
    inventory: baseInventory,
    previous: stored({
      compareFingerprint: combined,
      compareInventoryFingerprint: inventoryFp,
      compareSettingsFingerprint: settingsFp,
    }),
    previousInventory: baseInventory,
  });
  assert.equal(decision.skipCompare, false);
  assert.match(decision.logMessage, /Matching settings changed/i);
});

test("changing prefix seconds reuses the visual compare", () => {
  const scan = defaultScan();
  const settingsFp = fingerprintMatchingSettings(scan);
  assert.equal(fingerprintMatchingSettings({ ...scan, prefixSeconds: 2 }), settingsFp);
  const inventoryFp = fingerprintInventory(baseInventory);
  const combined = combinedCompareFingerprint(inventoryFp, settingsFp, scan.timeWindowDays);
  const decision = decideCompareRun({
    scan: { ...scan, prefixSeconds: 2 },
    inventory: baseInventory,
    previous: stored({
      compareFingerprint: combined,
      compareInventoryFingerprint: inventoryFp,
      compareSettingsFingerprint: settingsFp,
      compareTimeWindowDays: scan.timeWindowDays,
    }),
    previousInventory: baseInventory,
  });
  assert.equal(decision.skipCompare, true);
  assert.match(decision.logMessage, /reusing last compare/i);
});

test("an edited capture date requires a compare when the window is on", () => {
  const scan = { ...defaultScan(), timeWindowDays: 7 };
  const settingsFp = fingerprintMatchingSettings(scan);
  const inventoryFp = fingerprintInventory(baseInventory);
  const saved = stored({
    compareFingerprint: combinedCompareFingerprint(inventoryFp, settingsFp, 7, "dates-a"),
    compareInventoryFingerprint: inventoryFp,
    compareSettingsFingerprint: settingsFp,
    compareTimeWindowDays: 7,
    compareTimesFingerprint: "dates-a",
  });
  const same = decideCompareRun({ scan, inventory: baseInventory, previous: saved, previousInventory: baseInventory, timesFingerprint: "dates-a" });
  assert.equal(same.skipCompare, true);

  const edited = decideCompareRun({ scan, inventory: baseInventory, previous: saved, previousInventory: baseInventory, timesFingerprint: "dates-b" });
  assert.equal(edited.skipCompare, false);
  assert.match(edited.logMessage, /capture dates changed/i);
  assert.equal(edited.compareTimesFingerprint, "dates-b");
});

test("capture dates only matter to compare while the window is on", () => {
  const scan = { ...defaultScan(), timeWindowDays: 0 };
  const settingsFp = fingerprintMatchingSettings(scan);
  const inventoryFp = fingerprintInventory(baseInventory);
  const saved = stored({
    compareFingerprint: combinedCompareFingerprint(inventoryFp, settingsFp, 0),
    compareInventoryFingerprint: inventoryFp,
    compareSettingsFingerprint: settingsFp,
    compareTimeWindowDays: 0,
  });
  const decision = decideCompareRun({ scan, inventory: baseInventory, previous: saved, previousInventory: baseInventory, timesFingerprint: "burst-only-dates" });
  assert.equal(decision.skipCompare, true);
  assert.equal(decision.compareTimesFingerprint, "");
  assert.equal(decision.timesFingerprint, "burst-only-dates");
});

test("fingerprints saved before capture dates existed stay valid", () => {
  const settingsFp = fingerprintMatchingSettings(defaultScan());
  const inventoryFp = fingerprintInventory(baseInventory);
  assert.equal(
    combinedCompareFingerprint(inventoryFp, settingsFp, 7),
    combinedCompareFingerprint(inventoryFp, settingsFp, 7, ""),
  );
  assert.notEqual(
    combinedCompareFingerprint(inventoryFp, settingsFp, 7),
    combinedCompareFingerprint(inventoryFp, settingsFp, 7, "dates"),
  );
});
