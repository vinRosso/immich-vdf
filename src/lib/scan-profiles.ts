import type { ScanSettings } from "./types";

/** Mirrors upstream VDF.GUI/Data/ScanProfiles.cs (managed scan knobs). */
export type ScanProfileId = "recommended" | "exact" | "edited" | "ai" | "deep";

type ProfilePatch = Pick<
  ScanSettings,
  | "percent"
  | "compareHorizontallyFlipped"
  | "ignoreBlackPixels"
  | "ignoreWhitePixels"
  | "partialClip"
  | "aiMatching"
  | "aiPartial"
  | "timeWindowDays"
  | "prefixSeconds"
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
    id: "recommended",
    name: "Recommended",
    hint: "A good starting point for most libraries.",
    badge: "recommended",
    patch: {
      percent: 96,
      compareHorizontallyFlipped: false,
      ignoreBlackPixels: false,
      ignoreWhitePixels: false,
      partialClip: false,
      aiMatching: true,
      aiPartial: false,
      timeWindowDays: 7,
      prefixSeconds: 5,
    },
  },
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
      timeWindowDays: 1,
      prefixSeconds: 2,
    },
  },
  {
    id: "edited",
    name: "Edited & altered",
    hint: "Also finds crops, watermarks, flips and quality changes.",
    patch: {
      percent: 92,
      compareHorizontallyFlipped: true,
      ignoreBlackPixels: true,
      ignoreWhitePixels: true,
      partialClip: false,
      aiMatching: false,
      aiPartial: false,
      timeWindowDays: 7,
      prefixSeconds: 5,
    },
  },
  {
    id: "ai",
    name: "AI scan",
    hint: "Finds cropped, mirrored and edited copies, and clips cut from longer videos.",
    badge: "AI",
    patch: {
      percent: 92,
      compareHorizontallyFlipped: true,
      ignoreBlackPixels: true,
      ignoreWhitePixels: true,
      partialClip: false,
      aiMatching: true,
      aiPartial: true,
      timeWindowDays: 7,
      prefixSeconds: 5,
    },
  },
  {
    id: "deep",
    name: "Deep clean",
    hint: "Everything above, plus matching clips by sound. The slowest option.",
    badge: "slow",
    patch: {
      percent: 92,
      compareHorizontallyFlipped: true,
      ignoreBlackPixels: true,
      ignoreWhitePixels: true,
      partialClip: true,
      aiMatching: true,
      aiPartial: true,
      timeWindowDays: 0,
      prefixSeconds: 10,
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
    scan.aiPartial === patch.aiPartial &&
    scan.timeWindowDays === patch.timeWindowDays &&
    scan.prefixSeconds === patch.prefixSeconds
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
