import type { ScanSettings } from "./types";

/** Subset of VDF.Core.Settings serialized for vdf-cli --settings (field names match the engine). */
export type VdfCliSettingsFile = {
  IncludeSubDirectories: boolean;
  CompareHorizontallyFlipped: boolean;
  IgnoreBlackPixels: boolean;
  IgnoreWhitePixels: boolean;
};

export function buildVdfCliSettingsFile(scan: ScanSettings): VdfCliSettingsFile {
  return {
    IncludeSubDirectories: true,
    CompareHorizontallyFlipped: scan.compareHorizontallyFlipped,
    IgnoreBlackPixels: scan.ignoreBlackPixels,
    IgnoreWhitePixels: scan.ignoreWhitePixels,
  };
}
