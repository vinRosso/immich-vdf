import {
  combinedCompareFingerprint,
  countInventoryChanges,
  fingerprintInventory,
  fingerprintMatchingSettings,
  type InventoryEntry,
} from "./scan-inventory";
import type { ScanSettings, StoredResults } from "./types";

export type CompareDecision = {
  skipCompare: boolean;
  logMessage: string;
  inventoryFingerprint: string;
  settingsFingerprint: string;
  compareFingerprint: string;
};

export function decideCompareRun(input: {
  scan: ScanSettings;
  inventory: InventoryEntry[];
  previous: StoredResults | null;
  previousInventory: InventoryEntry[] | null;
}): CompareDecision {
  const settingsFingerprint = fingerprintMatchingSettings(input.scan);
  const inventoryFingerprint = fingerprintInventory(input.inventory);
  const compareFingerprint = combinedCompareFingerprint(
    inventoryFingerprint,
    settingsFingerprint,
    input.scan.timeWindowDays,
  );

  const base = {
    inventoryFingerprint,
    settingsFingerprint,
    compareFingerprint,
  };

  const previous = input.previous;
  if (!previous || previous.error) {
    return {
      ...base,
      skipCompare: false,
      logMessage: "[scan] No previous compare to reuse, comparing the library.",
    };
  }
  if (!previous.compareFingerprint) {
    return {
      ...base,
      skipCompare: false,
      logMessage: "[scan] No saved compare fingerprint, comparing the library.",
    };
  }
  if (compareFingerprint === previous.compareFingerprint) {
    return {
      ...base,
      skipCompare: true,
      logMessage: "[scan] Library unchanged, reusing last compare.",
    };
  }

  if (
    previous.compareSettingsFingerprint &&
    previous.compareSettingsFingerprint !== settingsFingerprint
  ) {
    return {
      ...base,
      skipCompare: false,
      logMessage: "[scan] Matching settings changed, comparing the library.",
    };
  }

  const priorInventory = input.previousInventory ?? [];
  const changed = countInventoryChanges(priorInventory, input.inventory);
  if (changed === 0 && previous.compareTimeWindowDays !== input.scan.timeWindowDays) {
    return {
      ...base,
      skipCompare: false,
      logMessage: windowChangeMessage(previous.compareTimeWindowDays, input.scan.timeWindowDays),
    };
  }
  if (changed > 0) {
    return {
      ...base,
      skipCompare: false,
      logMessage: `[scan] ${changed} file${changed === 1 ? "" : "s"} changed, comparing the library.`,
    };
  }

  return {
    ...base,
    skipCompare: false,
    logMessage: "[scan] Library changed, comparing the library.",
  };
}

function windowChangeMessage(previousDays: number | null | undefined, nextDays: number): string {
  if (nextDays <= 0)
    return "[scan] Comparing the whole library. Stored scores are reused; pairs outside the saved window are compared.";
  if (previousDays === 0 || (typeof previousDays === "number" && nextDays < previousDays))
    return "[scan] Narrower capture window. Reusing saved comparisons.";
  if (typeof previousDays === "number" && nextDays > previousDays)
    return "[scan] Wider capture window. Comparing pairs outside the previous window.";
  return "[scan] Capture-time window changed. Reusing saved comparisons.";
}
