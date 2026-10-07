import assert from "node:assert/strict";
import test from "node:test";
import { PREFIX_CACHE_REVISION, prefixCacheAction, type PrefixCache } from "../src/lib/prefix-cache";
import { prefixClusters, type TimedImage } from "../src/lib/prefix-groups";

function cache(overrides: Partial<PrefixCache> = {}): PrefixCache {
  return {
    revision: PREFIX_CACHE_REVISION,
    inventoryFingerprint: "library",
    timeWindowDays: 7,
    prefixSeconds: 5,
    images: [],
    clusters: [],
    baseGroups: [],
    ...overrides,
  };
}

const same = { inventoryFingerprint: "library", timeWindowDays: 7, prefixSeconds: 5 };

test("saved prefix groups are reused when the library and prefix seconds are unchanged", () => {
  assert.equal(prefixCacheAction(cache(), same), "reuse");
});

test("a smaller or wider prefix rebuilds from saved times, and a new file reads times again", () => {
  assert.equal(prefixCacheAction(cache(), { ...same, prefixSeconds: 2 }), "regroup");
  assert.equal(prefixCacheAction(cache(), { ...same, prefixSeconds: 10 }), "regroup");
  assert.equal(prefixCacheAction(cache(), { ...same, timeWindowDays: 30 }), "regroup");
  assert.equal(prefixCacheAction(cache(), { ...same, inventoryFingerprint: "changed" }), "reread");
  assert.equal(prefixCacheAction(cache({ revision: 0 }), same), "reread");
  assert.equal(prefixCacheAction(null, same), "reread");
});

test("saved image times split when prefix seconds shrink and join when they grow", () => {
  const t0 = Date.parse("2024-06-01T12:00:00.000Z");
  const images: TimedImage[] = [
    { path: "/a/IMG_1.jpg", dateCreatedMs: t0, sizeBytes: 1 },
    { path: "/a/IMG_2.jpg", dateCreatedMs: t0 + 4_000, sizeBytes: 1 },
    { path: "/a/IMG_3.jpg", dateCreatedMs: t0 + 10_000, sizeBytes: 1 },
  ];
  assert.deepEqual(prefixClusters(images, 5), [["/a/IMG_1.jpg", "/a/IMG_2.jpg"]]);
  assert.deepEqual(prefixClusters(images, 10), [["/a/IMG_1.jpg", "/a/IMG_2.jpg", "/a/IMG_3.jpg"]]);
  assert.deepEqual(prefixClusters(images, 2), []);
});
