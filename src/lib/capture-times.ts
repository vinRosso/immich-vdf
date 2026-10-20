import { createHash } from "node:crypto";
import path from "node:path";
import { loadConfig } from "./config";
import { errorText } from "./errors";
import type { ImmichAssetTime } from "./immich";
import { cliPathToOriginal } from "./immich-join";
import { readJson, writeJson } from "./json-file";
import { pathKey, type TimedImage } from "./prefix-groups";
import type { InventoryEntry } from "./scan-inventory";
import type { PathMapEntry, SectionId, StoredGroup } from "./types";

/**
 * Capture dates for the files in a scan, by the first source that has one:
 * 1. Immich's own date, which already reflects dates edited in Immich or in a sidecar file
 * 2. the date inside the file (EXIF, or the container tag of a HEIC or a video)
 * Files with neither keep the file system date the engine already has.
 */
export type CaptureTimes = {
  /** Scan path to ISO date, only for files where a better date than the file system's is known. */
  times: Map<string, string>;
  /** The same dates by `pathKey`, in milliseconds, for matching result items. */
  msByKey: Map<string, number>;
  /** Changes whenever any date in `times` changes, appears or goes. */
  fingerprint: string;
  fromImmich: number;
  fromFiles: number;
};

export type CaptureSources = {
  /** Assets Immich changed since `updatedAfter`; every asset when it is undefined. Missing when Immich is not set up. */
  listImmichTimes?: (updatedAfter: string | undefined) => Promise<ImmichAssetTime[]>;
  /** Immich's original paths to scan paths. */
  maps: PathMapEntry[];
  /** Dates read from the files themselves, by scan path. Throws when the files could not be read. */
  readFileDates: (paths: string[]) => Promise<Map<string, string>>;
  log: (line: string) => void;
};

type ImmichTimesCache = {
  version: 1;
  /** Newest `updatedAt` seen. The next run only asks for assets changed after it. */
  updatedAfter: string | null;
  byPath: Record<string, string>;
};

type FileDatesCache = {
  version: 1;
  byPath: Record<string, { sizeBytes: number; mtimeMs: number; date: string | null }>;
};

function dataFile(name: string): string {
  return path.join(loadConfig().dataDir, name);
}

function immichKey(originalPath: string): string {
  return originalPath.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Ask for a little before the newest date seen, so an update that landed in the same instant is not missed. */
function updatedAfterWithMargin(updatedAfter: string | null): string | undefined {
  if (!updatedAfter) return undefined;
  const ms = Date.parse(updatedAfter);
  return Number.isFinite(ms) ? new Date(ms - 1000).toISOString() : undefined;
}

async function immichDates(sources: CaptureSources): Promise<Map<string, string>> {
  const file = dataFile("immich-times.json");
  const cache = await readJson<ImmichTimesCache>(file, { version: 1, updatedAfter: null, byPath: {} });
  if (cache.version !== 1) {
    cache.updatedAfter = null;
    cache.byPath = {};
  }
  if (sources.listImmichTimes) {
    sources.log("[scan] Reading capture dates from Immich…");
    try {
      const changes = await sources.listImmichTimes(updatedAfterWithMargin(cache.updatedAfter));
      let newest = cache.updatedAfter;
      let changed = false;
      for (const asset of changes) {
        const key = immichKey(asset.originalPath);
        if (cache.byPath[key] !== asset.fileCreatedAt) {
          cache.byPath[key] = asset.fileCreatedAt;
          changed = true;
        }
        if (!newest || asset.updatedAt > newest) {
          newest = asset.updatedAt;
          changed = true;
        }
      }
      if (changed) {
        cache.updatedAfter = newest;
        await writeJson(file, cache);
      }
      sources.log(`[scan] Reading capture dates from Immich… ${changes.length.toLocaleString()} changed`);
    } catch (error) {
      sources.log(`[scan] Could not read capture dates from Immich (${errorText(error)}). Using the dates saved earlier.`);
    }
  }
  return new Map(Object.entries(cache.byPath));
}

/** Dates from the files for those that Immich does not know. Results, including "no date", are kept per file. */
async function fileDates(
  section: SectionId,
  files: InventoryEntry[],
  sources: CaptureSources,
): Promise<Map<string, string>> {
  const file = dataFile(`file-dates-${section}.json`);
  const cache = await readJson<FileDatesCache>(file, { version: 1, byPath: {} });
  const found = new Map<string, string>();
  const next: FileDatesCache["byPath"] = {};
  const unread: InventoryEntry[] = [];
  for (const entry of files) {
    const saved = cache.version === 1 ? cache.byPath[entry.path] : undefined;
    if (saved && saved.sizeBytes === entry.sizeBytes && saved.mtimeMs === entry.mtimeMs) {
      next[entry.path] = saved;
      if (saved.date) found.set(entry.path, saved.date);
    } else {
      unread.push(entry);
    }
  }
  if (unread.length > 0) {
    sources.log(`[scan] Reading capture dates from files… ${unread.length.toLocaleString()} to read`);
    try {
      const read = await sources.readFileDates(unread.map((entry) => entry.path));
      for (const entry of unread) {
        const date = read.get(entry.path) ?? null;
        next[entry.path] = { sizeBytes: entry.sizeBytes, mtimeMs: entry.mtimeMs, date };
        if (date) found.set(entry.path, date);
      }
    } catch (error) {
      sources.log(`[scan] Could not read capture dates from files (${errorText(error)}). Using file system dates.`);
      return found;
    }
  }
  const sameSize = Object.keys(cache.byPath).length === Object.keys(next).length;
  if (unread.length > 0 || !sameSize) await writeJson(file, { version: 1, byPath: next } satisfies FileDatesCache);
  return found;
}

export async function collectCaptureTimes(
  section: SectionId,
  inventory: InventoryEntry[],
  sources: CaptureSources,
): Promise<CaptureTimes> {
  const times = new Map<string, string>();
  let fromImmich = 0;
  const unknown: InventoryEntry[] = [];

  const immich = sources.listImmichTimes ? await immichDates(sources) : new Map<string, string>();
  for (const entry of inventory) {
    const original = immich.size > 0 ? cliPathToOriginal(entry.path, sources.maps) : null;
    const date = original ? immich.get(immichKey(original)) : undefined;
    if (date) {
      times.set(entry.path, date);
      fromImmich += 1;
    } else {
      unknown.push(entry);
    }
  }

  const fromFilesMap = await fileDates(section, unknown, sources);
  for (const [filePath, date] of fromFilesMap) times.set(filePath, date);

  const hash = createHash("sha256");
  const msByKey = new Map<string, number>();
  for (const entry of inventory) {
    const date = times.get(entry.path);
    if (!date) continue;
    hash.update(entry.path);
    hash.update("\0");
    hash.update(date);
    hash.update("\n");
    const ms = Date.parse(date);
    if (Number.isFinite(ms)) msByKey.set(pathKey(entry.path), ms);
  }
  return { times, msByKey, fingerprint: hash.digest("hex"), fromImmich, fromFiles: fromFilesMap.size };
}

/** Put the capture dates on result items, so the grid shows and sorts by them. */
export function applyCaptureDates(groups: StoredGroup[], capture: CaptureTimes | null): StoredGroup[] {
  if (!capture || capture.msByKey.size === 0) return groups;
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => {
      const ms = capture.msByKey.get(pathKey(item.path));
      return ms === undefined ? item : { ...item, dateCreatedMs: ms };
    }),
  }));
}

/** The same for the image list that burst groups are built from. */
export function applyCaptureDatesToImages(images: TimedImage[], capture: CaptureTimes | null): TimedImage[] {
  if (!capture || capture.msByKey.size === 0) return images;
  return images.map((image) => {
    const ms = capture.msByKey.get(pathKey(image.path));
    return ms === undefined ? image : { ...image, dateCreatedMs: ms };
  });
}

/** The prefix cache is only valid for the dates it was built with. */
export function prefixCacheKey(inventoryFingerprint: string, capture: CaptureTimes | null): string {
  return capture ? `${inventoryFingerprint}:${capture.fingerprint}` : inventoryFingerprint;
}

/** Whether a scan with these settings looks at capture dates at all. */
export function needsCaptureDates(scan: { timeWindowDays: number; prefixSeconds: number; includeImages: boolean }): boolean {
  return scan.timeWindowDays > 0 || (scan.prefixSeconds > 0 && scan.includeImages);
}
