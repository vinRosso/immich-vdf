import { createHash } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isScannedMedia } from "./media-extensions";
import { isInside } from "./path-jail";
import type { ScanSettings } from "./types";

export type InventoryEntry = {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
};

export type InventoryOptions = {
  /** Count image files too. Off when the scan only reads videos. */
  includeImages?: boolean;
  shouldAbort?: () => boolean;
};

/** Disk calls in flight at once while walking. */
const IO_LIMIT = 32;

function isExcluded(filePath: string, excludeRoots: string[]): boolean {
  const norm = path.normalize(filePath);
  return excludeRoots.some((root) => norm === root || isInside(root, norm));
}

/** Caps how many disk calls run at once. Only leaf calls go through it, so nested walks cannot deadlock. */
function createLimiter(max: number): <T>(work: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function limited<T>(work: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

type WalkContext = {
  excludeRoots: string[];
  includeImages: boolean;
  seen: Set<string>;
  entries: InventoryEntry[];
  limited: ReturnType<typeof createLimiter>;
  shouldAbort?: () => boolean;
};

/**
 * Real paths of the folders above this one that were entered through a root or a symlink.
 * A symlink that points back at one of them is a loop, so the walk stops there.
 * Plain folders are never skipped, which keeps the listing the same from run to run.
 */
type Ancestors = ReadonlySet<string>;

async function realPathOf(dir: string, context: WalkContext): Promise<string | null> {
  try {
    return await context.limited(() => realpath(dir));
  } catch {
    return null;
  }
}

async function recordFile(full: string, context: WalkContext): Promise<void> {
  const norm = path.normalize(full);
  if (context.seen.has(norm)) return;
  let info;
  try {
    info = await context.limited(() => stat(full));
  } catch {
    return;
  }
  if (!info.isFile() || context.seen.has(norm)) return;
  context.seen.add(norm);
  context.entries.push({ path: norm, sizeBytes: info.size, mtimeMs: info.mtimeMs });
}

async function walkDir(dir: string, context: WalkContext, ancestors: Ancestors): Promise<void> {
  if (context.shouldAbort?.()) return;
  if (isExcluded(path.normalize(dir), context.excludeRoots)) return;
  let dirents;
  try {
    dirents = await context.limited(() => readdir(dir, { withFileTypes: true }));
  } catch {
    return;
  }
  const work: Array<Promise<void>> = [];
  for (const dirent of dirents) {
    if (context.shouldAbort?.()) break;
    const full = path.join(dir, dirent.name);
    if (isExcluded(path.normalize(full), context.excludeRoots)) continue;
    if (dirent.isDirectory()) {
      work.push(walkDir(full, context, ancestors));
    } else if (dirent.isFile()) {
      if (isScannedMedia(dirent.name, context.includeImages)) work.push(recordFile(full, context));
    } else if (dirent.isSymbolicLink()) {
      work.push(followLink(full, dirent.name, context, ancestors));
    }
  }
  await Promise.all(work);
}

/** A symlink may point at a folder or a file. The scan follows both. */
async function followLink(full: string, name: string, context: WalkContext, ancestors: Ancestors): Promise<void> {
  let info;
  try {
    info = await context.limited(() => stat(full));
  } catch {
    return;
  }
  if (info.isDirectory()) {
    const real = await realPathOf(full, context);
    if (real === null || ancestors.has(real)) return;
    await walkDir(full, context, new Set([...ancestors, real]));
  } else if (info.isFile() && isScannedMedia(name, context.includeImages)) await recordFile(full, context);
}

function byPath(a: InventoryEntry, b: InventoryEntry): number {
  if (a.path < b.path) return -1;
  return a.path > b.path ? 1 : 0;
}

/** Walk include roots (minus exclude prefixes) the same way the scan job resolves paths. */
export async function walkScanInventory(
  includes: string[],
  excludes: string[],
  options: InventoryOptions = {},
): Promise<InventoryEntry[]> {
  const context: WalkContext = {
    excludeRoots: excludes.map((folder) => path.normalize(folder)),
    includeImages: options.includeImages ?? true,
    seen: new Set(),
    entries: [],
    limited: createLimiter(IO_LIMIT),
    shouldAbort: options.shouldAbort,
  };
  for (const include of includes) {
    if (options.shouldAbort?.()) break;
    const root = path.normalize(include);
    const real = await realPathOf(root, context);
    await walkDir(root, context, new Set(real === null ? [] : [real]));
  }
  return context.entries.sort(byPath);
}

export function fingerprintInventory(entries: InventoryEntry[]): string {
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.path);
    hash.update("\0");
    hash.update(String(entry.sizeBytes));
    hash.update("\0");
    hash.update(String(entry.mtimeMs));
    hash.update("\n");
  }
  return hash.digest("hex");
}

/** Settings that change which pairs match. Parallelism only changes speed, so it is left out. */
export function fingerprintMatchingSettings(scan: ScanSettings): string {
  const payload = {
    threshold: scan.threshold,
    percent: scan.percent,
    includeImages: scan.includeImages,
    usePhash: scan.usePhash,
    partialClip: scan.partialClip,
    aiMatching: scan.aiMatching,
    aiPartial: scan.aiPartial,
    compareHorizontallyFlipped: scan.compareHorizontallyFlipped,
    ignoreBlackPixels: scan.ignoreBlackPixels,
    ignoreWhitePixels: scan.ignoreWhitePixels,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function combinedCompareFingerprint(inventoryFp: string, settingsFp: string, timeWindowDays = 0): string {
  return createHash("sha256")
    .update(inventoryFp)
    .update(":")
    .update(settingsFp)
    .update(":")
    .update(String(timeWindowDays))
    .digest("hex");
}

export function countInventoryChanges(before: InventoryEntry[], after: InventoryEntry[]): number {
  const beforeByPath = new Map(before.map((entry) => [entry.path, entry]));
  const afterPaths = new Set<string>();
  let changes = 0;
  for (const entry of after) {
    afterPaths.add(entry.path);
    const prev = beforeByPath.get(entry.path);
    if (!prev) changes++;
    else if (prev.sizeBytes !== entry.sizeBytes || prev.mtimeMs !== entry.mtimeMs) changes++;
  }
  for (const entry of before) {
    if (!afterPaths.has(entry.path)) changes++;
  }
  return changes;
}
