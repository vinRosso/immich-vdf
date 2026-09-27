import type { ScanSettings } from "./types";

/** Defaults aligned with vdf-cli / VDF.Core Settings. */
export function defaultScan(): ScanSettings {
  return {
    includes: [],
    excludes: [],
    threshold: 5,
    percent: 96,
    parallelism: 1,
    includeImages: true,
    usePhash: false,
    partialClip: false,
    aiMatching: false,
    aiPartial: false,
    compareHorizontallyFlipped: false,
    ignoreBlackPixels: false,
    ignoreWhitePixels: false,
  };
}

export function normalizeScan(scan: Partial<ScanSettings>): ScanSettings {
  return { ...defaultScan(), ...scan };
}
