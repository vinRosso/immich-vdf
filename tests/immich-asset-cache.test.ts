import assert from "node:assert/strict";
import test from "node:test";
import { applyStackMembershipToCache, assetsFromCache } from "../src/lib/immich-asset-index";

test("a created stack replaces cached ids and string entries", () => {
  const next = applyStackMembershipToCache(
    {
      byPath: {
        "/data/a.jpg": "asset-a",
        "/data/b.jpg": { id: "asset-b", stackId: "old", stackPrimary: true },
        "/data/c.jpg": { id: "asset-c", stackId: "old", stackPrimary: false },
      },
    },
    [
      { assetId: "asset-a", originalPath: "/data/a.jpg", stackId: "new", stackPrimary: true },
      { assetId: "asset-b", originalPath: "/data/b.jpg", stackId: "new", stackPrimary: false },
      { assetId: "asset-c", originalPath: null, stackId: null, stackPrimary: false },
    ],
  );
  const assets = assetsFromCache(next, ["/data/a.jpg", "/data/b.jpg", "/data/c.jpg"]);
  assert.equal(assets[0]?.stackId, "new");
  assert.equal(assets[0]?.stackPrimary, true);
  assert.equal(assets[1]?.stackId, "new");
  assert.equal(assets[1]?.stackPrimary, false);
  assert.equal(assets[2]?.stackId, null);
});
