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
