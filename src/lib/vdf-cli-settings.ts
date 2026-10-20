import type { ScanSettings } from "./types";

/** Subset of VDF.Core.Settings serialized for vdf-cli --settings (field names match the engine). */
export type VdfCliSettingsFile = {
  IncludeSubDirectories: boolean;
  CompareHorizontallyFlipped: boolean;
  IgnoreBlackPixels: boolean;
  IgnoreWhitePixels: boolean;
  /**
   * The engine reads slow drives (network shares, spinning disks) at most this many files at once, 2 by default.
   * The Parallel setting is the user's own limit, so it applies there too.
   */
  HddMaxDegreeOfParallelism: number;
  /** Folders the run covers. The compare step has no --include, so without these it compares the whole database. */
  IncludeList?: string[];
  BlackList?: string[];
};

export type VdfCliScope = { includes: string[]; excludes: string[] };

export function buildVdfCliSettingsFile(scan: ScanSettings, scope?: VdfCliScope): VdfCliSettingsFile {
  return {
    IncludeSubDirectories: true,
    CompareHorizontallyFlipped: scan.compareHorizontallyFlipped,
    IgnoreBlackPixels: scan.ignoreBlackPixels,
    IgnoreWhitePixels: scan.ignoreWhitePixels,
    HddMaxDegreeOfParallelism: Math.max(1, Math.floor(scan.parallelism) || 1),
    ...(scope ? { IncludeList: scope.includes, BlackList: scope.excludes } : {}),
  };
}
