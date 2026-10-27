import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { clustersFromLists, filterInScope } from "./prefix-cluster-worker.mjs";
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

/** Same set as VDF.Core.FileUtils video extensions. Prefix groups are images only. */
const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".wmv", ".avi", ".mkv", ".flv", ".mov", ".mpg", ".mpeg", ".m4v", ".asf", ".f4v",
  ".webm", ".divx", ".m2t", ".m2ts", ".mts", ".vob", ".ts", ".rmvb", ".rm",
]);
/** Date plus clock, with milliseconds glued (`172025935`) or separated (`181604_952`). */
const CAPTURE_STAMP = /(\d{4})(\d{2})(\d{2})[\s._-](\d{2})(\d{2})(\d{2})(?:(\d{1,3})|[\s._-](\d{1,3}))?$/;
/** Copy counters cameras and Immich append: `name+1`, `name (1)`, `name~2`. */
const COPY_SUFFIX = /(?:~\d+|\+\d+|\s*\(\d+\))$/;
/** A trailing word: `.photo`, `_HDR`, `-WA`, `.NIGHT`. Spaces are part of the name, not a separator. */
const LETTER_TAG = /[._-][A-Za-z][A-Za-z0-9_-]*$/;
const TRAILING_NUMBER = /[\s._-]*\d+$/;

function nameStem(fileName: string): string {
  const base = fileName.replace(/\\/g, "/").split("/").pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function extensionOf(fileName: string): string {
  const base = fileName.replace(/\\/g, "/").split("/").pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

export function isVideoFileName(fileName: string): boolean {
  return VIDEO_EXTENSIONS.has(extensionOf(fileName));
}

/** Drop copy counters and letter tags. Numbers stay, so a clock at the end can still be read. */
function clockStem(fileName: string): string {
  let stem = nameStem(fileName);
  let next = stem;
  do {
    stem = next;
    next = stem.replace(COPY_SUFFIX, "").replace(LETTER_TAG, "");
  } while (next !== stem);
  return stem;
}

/**
 * Stable start of the name. Trailing numbers and words (`.photo`, `_HDR`, `-WA0022`)
 * come off; a title with spaces stays whole. Empty when the name is only numbers.
 */
export function filenamePrefixKey(fileName: string): string | null {
  let stem = nameStem(fileName);
  let next = stem;
  do {
    stem = next;
    next = stem.replace(COPY_SUFFIX, "").replace(LETTER_TAG, "").replace(TRAILING_NUMBER, "").replace(/[\s._-]+$/, "").trim();
  } while (next !== stem);
  if (!stem) return null;
  return stem.toLocaleLowerCase();
}

/**
 * Clock encoded in the file name, when the name has a date and a time.
 * `IMG_1798` and `IMG-20260213-WA0022` have neither, so grouping uses the stored file time.
 */
export function filenameCaptureMs(fileName: string): number | null {
  const match = clockStem(fileName).match(CAPTURE_STAMP);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] || match[8] || "";
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const millis = fraction.length === 0 ? 0 : Number(fraction.padEnd(3, "0"));
  if (!Number.isFinite(millis) || millis > 999) return null;
  const stamp = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  return Number.isFinite(stamp) ? stamp : null;
}

/**
 * Images that share a file-name prefix and were taken within `seconds` of the
 * previous image in that prefix. `0` disables the grouping.
 */
export function prefixClusters(images: readonly TimedImage[], seconds: number, windowDays = 0): string[][] {
  if (!Number.isFinite(seconds) || seconds <= 0) return [];
  return clustersFromLists(prefixBuckets(images), seconds * 1000, windowDays);
}

/**
 * Put each prefix on one worker. Larger prefixes are placed first so they do not
 * share a thread when a free worker exists. A prefix is never split.
 */
export function assignPrefixBuckets(lists: TimedImage[][], parallelism: number): TimedImage[][][] {
  if (lists.length === 0) return [];
  const slots = Math.max(1, Math.min(Math.floor(parallelism) || 1, lists.length));
  const loads = Array.from({ length: slots }, () => ({ count: 0, lists: [] as TimedImage[][] }));
  const ordered = [...lists].sort((a, b) => b.length - a.length);
  for (const list of ordered) {
    let lightest = loads[0]!;
    for (const slot of loads) {
      if (slot.count < lightest.count) lightest = slot;
    }
    lightest.lists.push(list);
    lightest.count += list.length;
  }
  return loads.map((slot) => slot.lists);
}

/**
 * Same groups as `prefixClusters`. Each prefix stays on a single worker.
 * Different prefixes are spread across `parallelism` workers.
 */
export async function prefixClustersParallel(
  images: readonly TimedImage[],
  seconds: number,
  parallelism: number,
  windowDays = 0,
): Promise<string[][]> {
  if (!Number.isFinite(seconds) || seconds <= 0) return [];
  const lists = prefixBuckets(images);
  const chunks = assignPrefixBuckets(lists, parallelism);
  if (chunks.length <= 1) return clustersFromLists(lists, seconds * 1000, windowDays);
  const windowMs = seconds * 1000;
  const parts = await Promise.all(
    chunks.map((chunk) => runPrefixWorker<string[][]>({ op: "window", lists: chunk, windowMs, windowDays })),
  );
  return parts.flat();
}

/** Below this many images, copying the list into workers costs more than filtering it here. */
const SCOPE_WORKER_MIN_IMAGES = 200_000;

/** Include/exclude filter. Each file is independent, so slices can run together. */
export async function imagesInScanScopeParallel(
  images: readonly TimedImage[],
  includes: readonly string[],
  excludes: readonly string[],
  parallelism: number,
): Promise<TimedImage[]> {
  const workers = Math.max(1, Math.floor(parallelism) || 1);
  if (workers === 1 || images.length < SCOPE_WORKER_MIN_IMAGES) return imagesInScanScope(images, includes, excludes);
  const size = Math.ceil(images.length / Math.min(workers, images.length));
  const slices: TimedImage[][] = [];
  for (let index = 0; index < images.length; index += size) {
    slices.push(images.slice(index, index + size));
  }
  const parts = await Promise.all(
    slices.map((slice) => runPrefixWorker<TimedImage[]>({ op: "scope", images: slice, includes, excludes })),
  );
  return parts.flat();
}

function prefixBuckets(images: readonly TimedImage[]): TimedImage[][] {
  const buckets = new Map<string, TimedImage[]>();
  for (const image of images) {
    const name = image.fileName?.trim() || fileNameOf(image.path);
    if (isVideoFileName(name)) continue;
    const key = filenamePrefixKey(name);
    if (!key) continue;
    const captured = filenameCaptureMs(name);
    const dateCreatedMs = captured ?? image.dateCreatedMs;
    if (!Number.isFinite(dateCreatedMs) || dateCreatedMs <= 0) continue;
    const dated = dateCreatedMs === image.dateCreatedMs ? image : { ...image, dateCreatedMs };
    const list = buckets.get(key);
    if (list) list.push(dated);
    else buckets.set(key, [dated]);
  }
  return [...buckets.values()];
}

/**
 * Spawn the script on disk. Next copies `new URL("./….mjs", import.meta.url)`
 * into the build without its sibling import, and that copy fails to start.
 */
function workerScriptReady(file: string): boolean {
  return existsSync(file) && existsSync(path.join(path.dirname(file), "capture-window.mjs"));
}

function prefixWorkerFile(): string {
  const fromCwd = path.join(process.cwd(), "src", "lib", "prefix-cluster-worker.mjs");
  if (workerScriptReady(fromCwd)) return fromCwd;
  // tsx loads this module from src/lib on both Windows and Linux. The Next build's
  // copied worker does not sit next to capture-window.mjs, so that copy is skipped.
  const beside = fileURLToPath(new URL("./prefix-cluster-worker.mjs", import.meta.url));
  if (workerScriptReady(beside)) return beside;
  throw new Error(`Prefix worker script is missing: ${fromCwd}`);
}

function runPrefixWorker<T>(workerData: object): Promise<T> {
  const workerFile = prefixWorkerFile();
  return new Promise((resolve, reject) => {
    // Not `new Worker(file)`: Turbopack treats that as a module reference and, with a runtime
    // path, tries to bundle every file in the project (turbopackIgnore has no effect there).
    const worker: Worker = Reflect.construct(Worker, [workerFile, { workerData }]);
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      settle();
    };
    worker.once("message", (message: T) => finish(() => resolve(message)));
    worker.once("error", (error) => finish(() => reject(error)));
    worker.once("exit", (code) => {
      if (code !== 0) finish(() => reject(new Error(`Prefix grouping worker exited with code ${code}`)));
    });
  });
}

/** Keep images under the folders this scan includes, and drop anything under an exclude. */
export function imagesInScanScope(
  images: readonly TimedImage[],
  includes: readonly string[],
  excludes: readonly string[],
): TimedImage[] {
  return filterInScope(images, includes, excludes);
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

/** Drop files that were added only by prefix grouping, so a new Prefix setting can be applied. */
export function stripPrefixItems(groups: readonly StoredGroup[]): StoredGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.flags.includes(PREFIX_FLAG)) }))
    .filter((group) => group.items.length >= 2);
}

/** Keep asset ids and resolved paths already known for a file. */
export function overlayKnownItems(previous: readonly StoredGroup[], next: readonly StoredGroup[]): StoredGroup[] {
  const known = new Map<string, StoredItem>();
  for (const group of previous) {
    for (const item of group.items) known.set(pathKey(item.path), item);
  }
  return next.map((group) => ({
    ...group,
    items: group.items.map((item) => known.get(pathKey(item.path)) ?? item),
  }));
}

/** Slashes are folded either way. Only Windows compares paths without case. */
export function comparePath(filePath: string, platform: NodeJS.Platform): string {
  const slashed = filePath.replace(/\\/g, "/");
  return platform === "win32" ? slashed.toLowerCase() : slashed;
}

export function pathKey(filePath: string): string {
  return comparePath(filePath, process.platform);
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
