import path from "node:path";
import { PREFIX_FLAG } from "./prefix-flag";
import type { StoredGroup, StoredItem } from "./types";

export { PREFIX_FLAG };

export type TimedImage = {
  path: string;
  dateCreatedMs: number;
  sizeBytes: number;
  /** Original file name when it differs from the name on disk. */
  fileName?: string | null;
};

/** File name used for the prefix: the original name, without an Immich `name+1` collision suffix. */
export function filenamePrefixKey(fileName: string): string | null {
  const base = fileName.replace(/\\/g, "/").split("/").pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  let stem = dot > 0 ? base.slice(0, dot) : base;
  stem = stem.replace(/\+\d+$/, "").replace(/\s*\(\d+\)$/, "");
  const stripped = stem.replace(/[\s._-]*\d+$/, "").replace(/[\s._-]+$/, "").trim();
  if (!stripped) return null;
  return stripped.toLocaleLowerCase();
}

/**
 * Images that share a file-name prefix and were taken within `seconds` of the
 * previous image in that prefix. `0` disables the grouping.
 */
export function prefixClusters(images: readonly TimedImage[], seconds: number): string[][] {
  if (!Number.isFinite(seconds) || seconds <= 0) return [];
  const windowMs = seconds * 1000;
  const buckets = new Map<string, TimedImage[]>();
  for (const image of images) {
    if (!Number.isFinite(image.dateCreatedMs) || image.dateCreatedMs <= 0) continue;
    const name = image.fileName?.trim() || fileNameOf(image.path);
    const key = filenamePrefixKey(name);
    if (!key) continue;
    const list = buckets.get(key);
    if (list) list.push(image);
    else buckets.set(key, [image]);
  }
  const clusters: string[][] = [];
  for (const list of buckets.values()) {
    list.sort((a, b) => a.dateCreatedMs - b.dateCreatedMs || a.path.localeCompare(b.path));
    let run: TimedImage[] = [];
    for (const image of list) {
      const previous = run[run.length - 1];
      if (previous && image.dateCreatedMs - previous.dateCreatedMs > windowMs) {
        if (run.length >= 2) clusters.push(run.map((entry) => entry.path));
        run = [];
      }
      run.push(image);
    }
    if (run.length >= 2) clusters.push(run.map((entry) => entry.path));
  }
  return clusters;
}

/** Keep images under the folders this scan includes, and drop anything under an exclude. */
export function imagesInScanScope(
  images: readonly TimedImage[],
  includes: readonly string[],
  excludes: readonly string[],
): TimedImage[] {
  const includeRoots = includes.map((root) => path.normalize(root));
  const excludeRoots = excludes.map((root) => path.normalize(root));
  return images.filter((image) => {
    const norm = path.normalize(image.path);
    if (excludeRoots.some((root) => coveredBy(root, norm))) return false;
    return includeRoots.some((root) => coveredBy(root, norm));
  });
}

function coveredBy(root: string, target: string): boolean {
  return target === root || pathIsInside(root, target);
}

function pathIsInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function parseImageTimes(raw: string): TimedImage[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const images: TimedImage[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { path?: unknown; date?: unknown; size?: unknown; fileName?: unknown };
    if (typeof record.path !== "string" || record.path.length === 0) continue;
    const ms = typeof record.date === "string" ? Date.parse(record.date) : 0;
    images.push({
      path: record.path,
      dateCreatedMs: Number.isFinite(ms) ? ms : 0,
      sizeBytes: typeof record.size === "number" && Number.isFinite(record.size) ? record.size : 0,
      fileName: typeof record.fileName === "string" ? record.fileName : null,
    });
  }
  return images;
}

export function prefixItem(image: TimedImage): StoredItem {
  return {
    path: image.path,
    similarity: -1,
    sizeBytes: image.sizeBytes,
    durationSeconds: 0,
    resolution: null,
    width: 0,
    height: 0,
    bitrateKbps: 0,
    bitDepth: 0,
    audioBitrateKbps: 0,
    dateCreatedMs: image.dateCreatedMs,
    flags: [PREFIX_FLAG],
    partialClipOffsetSeconds: 0,
    isImage: true,
    format: null,
    fps: 0,
    assetId: null,
    originalPath: null,
    stackId: null,
    stackPrimary: false,
  };
}

/** Add name-and-time clusters beside visual groups, and pull a cluster into a visual group when they share a file. */
export function applyPrefixClusters(
  groups: readonly StoredGroup[],
  clusters: readonly (readonly string[])[],
  lookup: ReadonlyMap<string, StoredItem>,
): StoredGroup[] {
  type Bucket = { groupId: string; items: Map<string, StoredItem>; prefix: boolean };
  const buckets: Bucket[] = groups.map((group) => ({
    groupId: group.groupId,
    prefix: false,
    items: new Map(group.items.map((item) => [pathKey(item.path), item])),
  }));
  const parent = buckets.map((_, index) => index);
  const pathOwner = new Map<string, number>();
  buckets.forEach((bucket, index) => {
    for (const key of bucket.items.keys()) pathOwner.set(key, index);
  });

  function find(index: number): number {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  }

  function unite(a: number, b: number): number {
    const left = find(a);
    const right = find(b);
    if (left === right) return left;
    const keep = Math.min(left, right);
    parent[Math.max(left, right)] = keep;
    return keep;
  }

  let created = 0;
  for (const cluster of clusters) {
    const members: string[] = [];
    const seen = new Set<string>();
    for (const file of cluster) {
      const key = pathKey(file);
      if (seen.has(key)) continue;
      seen.add(key);
      members.push(file);
    }
    if (members.length < 2) continue;
    let root = -1;
    const fresh: string[] = [];
    for (const file of members) {
      const owner = pathOwner.get(pathKey(file));
      if (owner === undefined) {
        fresh.push(file);
        continue;
      }
      root = root < 0 ? find(owner) : unite(root, find(owner));
    }
    if (root < 0) {
      if (fresh.length < 2) continue;
      created += 1;
      buckets.push({ groupId: `prefix:${created}`, prefix: true, items: new Map() });
      parent.push(buckets.length - 1);
      root = buckets.length - 1;
    } else {
      root = find(root);
    }
    for (const file of fresh) {
      const key = pathKey(file);
      const item = lookup.get(key);
      if (!item) continue;
      buckets[root].items.set(key, item);
      pathOwner.set(key, root);
    }
  }

  const folded = new Map<number, { groupId: string; items: StoredItem[] }>();
  for (let index = 0; index < buckets.length; index += 1) {
    const root = find(index);
    let dest = folded.get(root);
    if (!dest) {
      dest = { groupId: buckets[root].groupId, items: [] };
      folded.set(root, dest);
    }
    const have = new Set(dest.items.map((item) => pathKey(item.path)));
    const adding = [...buckets[index].items.values()].filter((item) => !have.has(pathKey(item.path)));
    if (buckets[index].prefix) adding.sort(byDate);
    dest.items.push(...adding);
  }
  return [...folded.values()]
    .filter((group) => group.items.length >= 2)
    .map((group) => ({ groupId: group.groupId, items: group.items }));
}

export function pathKey(filePath: string): string {
  const slashed = filePath.replace(/\\/g, "/");
  return process.platform === "win32" ? slashed.toLowerCase() : slashed;
}

function fileNameOf(filePath: string): string {
  const slashed = filePath.replace(/\\/g, "/");
  return slashed.slice(slashed.lastIndexOf("/") + 1);
}

function byDate(a: StoredItem, b: StoredItem): number {
  const delta = (a.dateCreatedMs || 0) - (b.dateCreatedMs || 0);
  if (delta !== 0) return delta;
  return a.path.localeCompare(b.path);
}
