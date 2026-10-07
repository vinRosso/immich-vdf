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

function coveredBy(root, target) {
  if (target === root) return true;
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Per-file include/exclude check. Images in one slice do not share a prefix constraint. */
export function filterInScope(images, includes, excludes) {
  const includeRoots = includes.map((root) => path.normalize(root));
  const excludeRoots = excludes.map((root) => path.normalize(root));
  return images.filter((image) => {
    const norm = path.normalize(image.path);
    if (excludeRoots.some((root) => coveredBy(root, norm))) return false;
    return includeRoots.some((root) => coveredBy(root, norm));
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
