import type { ScanSettings } from "./types";

/** Mirrors upstream VDF.GUI/Data/ScanProfiles.cs (managed scan knobs). */
export type ScanProfileId = "exact" | "edited" | "ai" | "deep";

type ProfilePatch = Pick<
  ScanSettings,
  | "percent"
  | "compareHorizontallyFlipped"
  | "ignoreBlackPixels"
  | "ignoreWhitePixels"
  | "partialClip"
  | "aiMatching"
  | "aiPartial"
>;

export type ScanProfile = {
  id: ScanProfileId;
  name: string;
  hint: string;
  badge?: string;
  patch: ProfilePatch;
};

export const SCAN_PROFILES: ScanProfile[] = [
  {
    id: "exact",
    name: "Exact & near",
    hint: "Copies, renames and re-encodes of the same video or photo.",
    badge: "fastest",
    patch: {
      percent: 98,
      compareHorizontallyFlipped: false,
      ignoreBlackPixels: false,
      ignoreWhitePixels: false,
      partialClip: false,
      aiMatching: false,
      aiPartial: false,
    },
  },
  {
    id: "edited",
    name: "Edited & altered",
    hint: "Also finds crops, watermarks, flips and quality changes.",
    badge: "recommended",
    patch: {
      percent: 92,
      compareHorizontallyFlipped: true,
      ignoreBlackPixels: true,
      ignoreWhitePixels: true,
      partialClip: false,
      aiMatching: false,
      aiPartial: false,
    },
  },
  {
    id: "ai",
    name: "AI scan",
    hint: "Cropped, mirrored and re-edited copies, and clips cut from longer videos — without decoding audio.",
    badge: "AI",
    patch: {
      percent: 92,
      compareHorizontallyFlipped: true,
      ignoreBlackPixels: true,
      ignoreWhitePixels: true,
      partialClip: false,
      aiMatching: true,
      aiPartial: true,
    },
  },
  {
    id: "deep",
    name: "Deep clean",
    hint: "Everything above, plus audio-fingerprint clip matching. Slowest first scan.",
    badge: "slow",
    patch: {
      percent: 92,
      compareHorizontallyFlipped: true,
      ignoreBlackPixels: true,
      ignoreWhitePixels: true,
      partialClip: true,
      aiMatching: true,
      aiPartial: true,
    },
  },
];

function knobsMatch(scan: ScanSettings, patch: ProfilePatch): boolean {
  return (
    scan.percent === patch.percent &&
    scan.compareHorizontallyFlipped === patch.compareHorizontallyFlipped &&
    scan.ignoreBlackPixels === patch.ignoreBlackPixels &&
    scan.ignoreWhitePixels === patch.ignoreWhitePixels &&
    scan.partialClip === patch.partialClip &&
    scan.aiMatching === patch.aiMatching &&
    scan.aiPartial === patch.aiPartial
  );
}

export function detectScanProfile(scan: ScanSettings): ScanProfileId | "custom" {
  for (const profile of SCAN_PROFILES) {
    if (knobsMatch(scan, profile.patch)) return profile.id;
  }
  return "custom";
}

export function applyScanProfile(scan: ScanSettings, id: ScanProfileId): ScanSettings {
  const profile = SCAN_PROFILES.find((entry) => entry.id === id);
  if (!profile) return scan;
  return { ...scan, ...profile.patch };
}
