import { suggestScanParallelism } from "./scan-parallelism";
import type { ScanSettings, SectionId } from "./types";

/** Capture-time compare window (days). Files: whole library; Immich: narrow near-duplicates. */
export function defaultTimeWindowDays(section: SectionId): number {
  return section === "immich" ? 7 : 0;
}

/** Defaults aligned with vdf-cli / VDF.Core Settings. Pass core count to set Parallel. */
export function defaultScan(section: SectionId = "server", cores?: number): ScanSettings {
  return {
    includes: [],
    excludes: [],
    threshold: 5,
    percent: 96,
    parallelism: cores === undefined ? 1 : suggestScanParallelism(cores),
    includeImages: true,
    usePhash: false,
    partialClip: false,
    aiMatching: false,
    aiPartial: false,
    compareHorizontallyFlipped: false,
    ignoreBlackPixels: false,
    ignoreWhitePixels: false,
    timeWindowDays: defaultTimeWindowDays(section),
  };
}

export function normalizeScan(scan: Partial<ScanSettings>, section: SectionId = "server"): ScanSettings {
  return { ...defaultScan(section), ...scan };
}
