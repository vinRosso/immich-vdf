import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  albumSetsMismatch,
  missingAlbumIds,
  removableAlbumIds,
} from "../src/lib/immich-album-sync.ts";

describe("immich-album-sync", () => {
  const byAsset = {
    a1: [{ id: "al1", name: "Trip" }],
    a2: [],
  };

  it("detects album mismatch across duplicates", () => {
    assert.equal(albumSetsMismatch(["a1", "a2"], byAsset), true);
    assert.equal(albumSetsMismatch(["a1", "a1"], byAsset), false);
  });

  it("lists removable and missing albums for an asset", () => {
    assert.deepEqual(removableAlbumIds("a1", ["a1", "a2"], byAsset), ["al1"]);
    assert.deepEqual(missingAlbumIds("a2", ["a1", "a2"], byAsset), ["al1"]);
    assert.deepEqual(missingAlbumIds("a1", ["a1", "a2"], byAsset), []);
  });
});
