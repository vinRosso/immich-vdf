import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { sharesCaptureWindow } from "./capture-window.mjs";

/** Time-window one prefix list. Each list must already be a single prefix. */
export function clustersFromLists(lists, windowMs, windowDays = 0) {
  const clusters = [];
  for (const list of lists) {
    list.sort((a, b) => a.dateCreatedMs - b.dateCreatedMs || a.path.localeCompare(b.path));
    let run = [];
    for (const image of list) {
      const previous = run[run.length - 1];
      const anchor = run[0];
      const gapTooWide = previous && image.dateCreatedMs - previous.dateCreatedMs > windowMs;
      const outsideWindow = anchor && !sharesCaptureWindow(anchor.dateCreatedMs, image.dateCreatedMs, windowDays);
      if (gapTooWide || outsideWindow) {
        if (run.length >= 2) clusters.push(run.map((entry) => entry.path));
        run = [];
      }
      run.push(image);
    }
    if (run.length >= 2) clusters.push(run.map((entry) => entry.path));
  }
  return clusters;
}

function scopePath(filePath, pathImpl) {
  let norm = pathImpl.normalize(filePath);
  const root = pathImpl.parse(norm).root;
  while (norm.length > root.length && (norm.endsWith("/") || norm.endsWith("\\"))) {
    norm = norm.slice(0, -1);
  }
  return norm;
}

/** Windows paths are case-insensitive. A trailing separator must not make `photos` cover `photos-old`. */
export function coveredBy(root, target, pathImpl = path) {
  const fold = pathImpl.sep === "\\";
  const left = scopePath(root, pathImpl);
  const right = scopePath(target, pathImpl);
  const a = fold ? left.toLowerCase() : left;
  const b = fold ? right.toLowerCase() : right;
  if (a === b) return true;
  const sep = fold ? "\\" : "/";
  const prefix = a.endsWith(sep) ? a : a + sep;
  return b.startsWith(prefix);
}

/** Per-file include/exclude check. Images in one slice do not share a prefix constraint. */
export function filterInScope(images, includes, excludes, pathImpl = path) {
  return images.filter((image) => {
    if (excludes.some((root) => coveredBy(root, image.path, pathImpl))) return false;
    return includes.some((root) => coveredBy(root, image.path, pathImpl));
  });
}

if (parentPort && workerData) {
  if (workerData.op === "window") {
    parentPort.postMessage(clustersFromLists(workerData.lists, workerData.windowMs, workerData.windowDays ?? 0));
  } else if (workerData.op === "scope") {
    parentPort.postMessage(filterInScope(workerData.images, workerData.includes, workerData.excludes));
  } else {
    throw new Error(`Unknown prefix worker op: ${workerData.op}`);
  }
}
