import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isInside } from "./path-jail";
import type { ScanSettings } from "./types";

export type InventoryEntry = {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
};

function isExcluded(filePath: string, excludeRoots: string[]): boolean {
  const norm = path.normalize(filePath);
  return excludeRoots.some((root) => norm === root || isInside(root, norm));
}

async function walkDir(
  dir: string,
  excludeRoots: string[],
  seen: Set<string>,
  entries: InventoryEntry[],
): Promise<void> {
  const normDir = path.normalize(dir);
  if (isExcluded(normDir, excludeRoots)) return;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    const norm = path.normalize(full);
    if (isExcluded(norm, excludeRoots)) continue;
    let info;
    try {
      info = await stat(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      await walkDir(full, excludeRoots, seen, entries);
      continue;
    }
    if (!info.isFile()) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    entries.push({ path: norm, sizeBytes: info.size, mtimeMs: info.mtimeMs });
  }
}

/** Walk include roots (minus exclude prefixes) the same way the scan job resolves paths. */
export async function walkScanInventory(includes: string[], excludes: string[]): Promise<InventoryEntry[]> {
  const excludeRoots = excludes.map((folder) => path.normalize(folder));
  const seen = new Set<string>();
  const entries: InventoryEntry[] = [];
  for (const include of includes) {
    await walkDir(path.normalize(include), excludeRoots, seen, entries);
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
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

export function fingerprintMatchingSettings(scan: ScanSettings): string {
  const payload = {
    threshold: scan.threshold,
    percent: scan.percent,
    parallelism: scan.parallelism,
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

export function combinedCompareFingerprint(inventoryFp: string, settingsFp: string): string {
  return createHash("sha256").update(inventoryFp).update(":").update(settingsFp).digest("hex");
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
