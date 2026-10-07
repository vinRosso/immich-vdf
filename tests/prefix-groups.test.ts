import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { similarityRange } from "../src/components/group-result-card";
import {
  applyPrefixClusters,
  assignPrefixBuckets,
  filenamePrefixKey,
  imagesInScanScope,
  imagesInScanScopeParallel,
  parseImageTimes,
  pathKey,
  prefixClusters,
  prefixClustersParallel,
  prefixItem,
  PREFIX_FLAG,
  type TimedImage,
} from "../src/lib/prefix-groups";
import type { ClientGroup } from "../src/lib/types";
import type { StoredGroup, StoredItem } from "../src/lib/types";

const t0 = Date.parse("2024-06-01T12:00:00.000Z");

function image(file: string, offsetSeconds: number, fileName?: string): TimedImage {
  return { path: file, dateCreatedMs: t0 + offsetSeconds * 1000, sizeBytes: 100, fileName };
}

function visual(file: string): StoredItem {
  return { ...prefixItem(image(file, 0)), similarity: 98, flags: [], sizeBytes: 50 };
}

test("a trailing number is the part that may differ", () => {
  assert.equal(filenamePrefixKey("IMG_1234.jpg"), filenamePrefixKey("IMG_1235.JPG"));
  assert.equal(filenamePrefixKey("photo+1.jpg"), filenamePrefixKey("photo.jpg"));
  assert.equal(filenamePrefixKey("Vacation 01.jpg"), filenamePrefixKey("Vacation 02.jpg"));
  assert.notEqual(filenamePrefixKey("IMG_1234.jpg"), filenamePrefixKey("DSC_1234.jpg"));
  assert.notEqual(filenamePrefixKey("photo.jpg"), filenamePrefixKey("photograph.jpg"));
  assert.equal(filenamePrefixKey("0001.jpg"), null);
});

test("images within the window that share a prefix become one group", () => {
  const clusters = prefixClusters(
    [image("/a/IMG_1000.jpg", 0), image("/a/IMG_1001.jpg", 4), image("/a/IMG_1002.jpg", 8), image("/a/DSC_1.jpg", 1)],
    5,
  );
  assert.deepEqual(clusters, [["/a/IMG_1000.jpg", "/a/IMG_1001.jpg", "/a/IMG_1002.jpg"]]);
});

test("a gap larger than the window starts a new group, and 0 disables grouping", () => {
  const images = [image("/a/IMG_1.jpg", 0), image("/a/IMG_2.jpg", 4), image("/a/IMG_3.jpg", 10)];
  const clusters = prefixClusters(images, 5);
  assert.deepEqual(clusters, [["/a/IMG_1.jpg", "/a/IMG_2.jpg"]]);
  assert.deepEqual(prefixClusters(images, 0), []);
});

test("an original file name is used when the disk name differs", () => {
  const clusters = prefixClusters(
    [
      image("/library/aa.jpg", 0, "IMG_10.jpg"),
      image("/library/bb.jpg", 3, "IMG_11.jpg"),
    ],
    5,
  );
  assert.deepEqual(clusters, [["/library/aa.jpg", "/library/bb.jpg"]]);
});

test("each prefix stays on one worker and different prefixes spread out", () => {
  const burst = (dir: string, count: number) => Array.from({ length: count }, (_, index) => image(`${dir}/IMG_${index}.jpg`, index));
  const large = burst("/a", 10);
  const medium = burst("/b", 4);
  const small = burst("/c", 1);
  const chunks = assignPrefixBuckets([small, large, medium], 2);
  const sizes = chunks.map((chunk) => chunk.map((list) => list.length).sort((a, b) => a - b));
  assert.deepEqual(sizes, [[10], [1, 4]]);
  const seen = new Set<string>();
  for (const chunk of chunks) {
    for (const list of chunk) {
      const dir = list[0].path.split("/")[1];
      assert.equal(seen.has(dir), false);
      seen.add(dir);
    }
  }
});

test("parallel prefix grouping matches the single-threaded result", async () => {
  const images = [
    image("/a/IMG_1000.jpg", 0),
    image("/a/IMG_1001.jpg", 4),
    image("/b/DSC_10.jpg", 0),
    image("/b/DSC_11.jpg", 3),
    image("/c/lone.jpg", 1),
  ];
  const sync = prefixClusters(images, 5).map((paths) => [...paths].sort());
  const parallel = (await prefixClustersParallel(images, 5, 4)).map((paths) => [...paths].sort());
  sync.sort((a, b) => a[0].localeCompare(b[0]));
  parallel.sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(parallel, sync);
});

test("prefix groups stay inside the capture-time window", () => {
  const day = 86_400;
  const images = [image("/a/IMG_1.jpg", 0), image("/a/IMG_2.jpg", 6 * day), image("/a/IMG_3.jpg", 12 * day)];
  assert.deepEqual(prefixClusters(images, 10 * day, 0), [["/a/IMG_1.jpg", "/a/IMG_2.jpg", "/a/IMG_3.jpg"]]);
  assert.deepEqual(prefixClusters(images, 10 * day, 7), [["/a/IMG_1.jpg", "/a/IMG_2.jpg"]]);
});

test("a prefix cluster joins a visual group that already contains one of the files", () => {
  const groups: StoredGroup[] = [{ groupId: "g", items: [visual("/a/IMG_1.jpg"), visual("/a/IMG_1b.jpg")] }];
  const extra = image("/a/IMG_2.jpg", 2);
  const lookup = new Map([[pathKey(extra.path), prefixItem(extra)]]);
  const next = applyPrefixClusters(groups, [["/a/IMG_1.jpg", extra.path]], lookup);
  assert.equal(next.length, 1);
  assert.equal(next[0].groupId, "g");
  assert.deepEqual(
    next[0].items.map((item) => item.path),
    ["/a/IMG_1.jpg", "/a/IMG_1b.jpg", extra.path],
  );
  assert.equal(next[0].items[0].similarity, 98);
  assert.equal(next[0].items[2].similarity, -1);
});

test("files that are not already grouped become their own group", () => {
  const first = image("/a/PXL_1.jpg", 0);
  const second = image("/a/PXL_2.jpg", 5);
  const lookup = new Map([
    [pathKey(first.path), prefixItem(first)],
    [pathKey(second.path), prefixItem(second)],
  ]);
  const next = applyPrefixClusters([], [[first.path, second.path]], lookup);
  assert.equal(next.length, 1);
  assert.equal(next[0].groupId, "prefix:1");
  assert.equal(next[0].items.length, 2);
});

test("prefix groups only use images inside the current includes and outside excludes", async () => {
  const include = path.normalize("/media/photos");
  const excluded = path.join(include, "archive");
  const inside = path.join(include, "IMG_1.jpg");
  const inArchive = path.join(excluded, "IMG_2.jpg");
  const leftover = path.normalize("/old-library/IMG_3.jpg");
  const images = [inside, inArchive, leftover].map((file) => image(file, 0));
  const kept = imagesInScanScope(images, [include], [excluded]);
  assert.deepEqual(kept.map((entry) => entry.path), [inside]);
  const parallel = await imagesInScanScopeParallel(images, [include], [excluded], 3);
  assert.deepEqual(parallel.map((entry) => entry.path), [inside]);
});

test("a card says Prefix only when every item came from a name-and-time group", () => {
  assert.equal(similarityRange(card([{ similarity: -1, flags: [PREFIX_FLAG] }, { similarity: -1, flags: [PREFIX_FLAG] }])), "Prefix");
  assert.equal(similarityRange(card([{ similarity: Number.NaN, flags: [] }, { similarity: -1, flags: [] }])), "—");
  assert.equal(similarityRange(card([{ similarity: 90, flags: [] }, { similarity: -1, flags: [PREFIX_FLAG] }])), "90%");
});

function card(items: { similarity: number; flags: string[] }[]): ClientGroup {
  return { groupId: "g", items } as ClientGroup;
}

test("image times JSON keeps path, date, and size", () => {
  const parsed = parseImageTimes(
    JSON.stringify([{ path: "/a/IMG_1.jpg", date: "2024-06-01T12:00:00.000Z", size: 42, fileName: "IMG_1.jpg" }]),
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].path, "/a/IMG_1.jpg");
  assert.equal(parsed[0].sizeBytes, 42);
  assert.equal(parsed[0].dateCreatedMs, t0);
  assert.equal(parsed[0].fileName, "IMG_1.jpg");
});
