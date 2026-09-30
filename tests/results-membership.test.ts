import assert from "node:assert/strict";
import test from "node:test";
import { membershipFromResults } from "../src/lib/results-membership";

test("membership indexes asset ids and paths from saved groups", () => {
  const membership = membershipFromResults({
    groups: [
      {
        items: [
          { path: "/photos/a.jpg", assetId: "asset-a" },
          { path: "/photos/b.jpg", assetId: null },
        ],
      },
      { items: [{ path: "/photos/c.jpg", assetId: "asset-c" }] },
    ],
  });
  assert.equal(membership.assetIds.has("asset-a"), true);
  assert.equal(membership.assetIds.has("asset-c"), true);
  assert.equal(membership.assetIds.has("asset-b"), false);
  assert.deepEqual([...membership.paths], ["/photos/a.jpg", "/photos/b.jpg", "/photos/c.jpg"]);
  assert.equal(membership.mediaByPath.get("/photos/a.jpg")?.isImage, false);
});
