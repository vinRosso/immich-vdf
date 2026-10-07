import path from "node:path";
import { loadConfig } from "./config";
import { exclusive, readJson, writeJson } from "./json-file";
import type { TimedImage } from "./prefix-groups";
import type { SectionId, StoredGroup } from "./types";

/** Bump when saved prefix groups can no longer be reused. */
export const PREFIX_CACHE_REVISION = 1;

export type PrefixCache = {
  revision: number;
  inventoryFingerprint: string;
  timeWindowDays: number;
  /** Prefix seconds the saved clusters were built with. */
  prefixSeconds: number;
  images: TimedImage[];
  clusters: string[][];
  /** Visual groups from before prefix grouping, so a new Prefix setting can be applied again. */
  baseGroups: StoredGroup[];
};

/** `regroup` rebuilds groups from saved image times. `reread` loads times from the scan database again. */
export function prefixCacheAction(
  cache: PrefixCache | null,
  input: { inventoryFingerprint: string; timeWindowDays: number; prefixSeconds: number },
): "reuse" | "regroup" | "reread" {
  if (!cache || cache.revision !== PREFIX_CACHE_REVISION) return "reread";
  if (cache.inventoryFingerprint !== input.inventoryFingerprint) return "reread";
  if (!Array.isArray(cache.images) || !Array.isArray(cache.clusters) || !Array.isArray(cache.baseGroups)) return "reread";
  if (cache.timeWindowDays !== input.timeWindowDays || cache.prefixSeconds !== input.prefixSeconds) return "regroup";
  return "reuse";
}

export function prefixRegroupLine(cache: PrefixCache, prefixSeconds: number, timeWindowDays: number): string {
  if (cache.prefixSeconds > prefixSeconds) {
    return `[scan] Prefix seconds is smaller (${cache.prefixSeconds} s to ${prefixSeconds} s). Rebuilding groups from saved times.`;
  }
  if (cache.prefixSeconds < prefixSeconds) {
    return `[scan] Prefix seconds is wider (${cache.prefixSeconds} s to ${prefixSeconds} s). Joining saved groups.`;
  }
  return `[scan] Capture window changed (${cache.timeWindowDays} to ${timeWindowDays} days). Rebuilding prefix groups from saved times.`;
}

function prefixCachePath(section: SectionId): string {
  return path.join(loadConfig().dataDir, "prefix", `${section}.json`);
}

export async function loadPrefixCache(section: SectionId): Promise<PrefixCache | null> {
  const cache = await readJson<PrefixCache | null>(prefixCachePath(section), null);
  if (!cache || cache.revision !== PREFIX_CACHE_REVISION) return null;
  if (!Array.isArray(cache.images) || !Array.isArray(cache.clusters) || !Array.isArray(cache.baseGroups)) return null;
  return cache;
}

export function savePrefixCache(section: SectionId, cache: PrefixCache): Promise<void> {
  return exclusive(() => writeJson(prefixCachePath(section), cache));
}
