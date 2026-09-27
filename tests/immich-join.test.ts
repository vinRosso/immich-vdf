import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assetsFromCache } from "../src/lib/immich-asset-index";
import { attachAssets, cliPathToOriginal, originalPathToCli, originalPathsForGroups } from "../src/lib/immich-join";

const maps = [
  { from: "/data", to: "/mnt/immich" },
  { from: "/mnt/photos", to: "/mnt/photos" },
];

describe("immich path join", () => {
  it("translates upload and external paths both ways", () => {
    assert.equal(cliPathToOriginal("/mnt/immich/a.mkv", maps), "/data/a.mkv");
    assert.equal(originalPathToCli("/data/a.mkv", maps), "/mnt/immich/a.mkv");
    assert.equal(cliPathToOriginal("/mnt/photos/a.jpg", maps), "/mnt/photos/a.jpg");
  });

  it("matches scan paths via a cli-path index", () => {
    const assets = [
      { id: "a1", originalPath: "/data/clip.mkv" },
      { id: "b1", originalPath: "/mnt/photos/pic.jpg" },
    ];
    const groups = attachAssets(
      [
        {
          groupId: "g1",
          items: [
            {
              path: "/mnt/immich/clip.mkv",
              similarity: 1,
              sizeBytes: 1,
              durationSeconds: 1,
              resolution: null,
              width: 0,
              height: 0,
              bitrateKbps: 0,
              bitDepth: 0,
              audioBitrateKbps: 0,
              dateCreatedMs: 0,
              flags: [],
              partialClipOffsetSeconds: 0,
              isImage: false,
              format: null,
              fps: 0,
              assetId: null,
              originalPath: null,
            },
          ],
        },
      ],
      assets,
      maps,
    );
    assert.equal(groups[0].items[0].assetId, "a1");
    assert.equal(groups[0].items[0].originalPath, "/data/clip.mkv");
  });

  it("collects original paths and reads them from the asset cache", () => {
    const paths = originalPathsForGroups(
      [
        {
          groupId: "g1",
          items: [
            {
              path: "/mnt/immich/clip.mkv",
              similarity: 1,
              sizeBytes: 1,
              durationSeconds: 1,
              resolution: null,
              width: 0,
              height: 0,
              bitrateKbps: 0,
              bitDepth: 0,
              audioBitrateKbps: 0,
              dateCreatedMs: 0,
              flags: [],
              partialClipOffsetSeconds: 0,
              isImage: false,
              format: null,
              fps: 0,
              assetId: null,
              originalPath: null,
            },
          ],
        },
      ],
      maps,
    );
    assert.deepEqual(paths, ["/data/clip.mkv"]);
    const matched = assetsFromCache({ byPath: { "/data/clip.mkv": "a1" } }, paths);
    assert.equal(matched[0]?.id, "a1");
  });
});
