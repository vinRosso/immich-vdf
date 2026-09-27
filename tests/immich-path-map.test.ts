import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveImmichPathMapSync } from "../src/lib/immich-path-map";

describe("resolveImmichPathMapSync", () => {
  it("maps Immich /data upload prefix to /immich and passes through external roots", () => {
    const priorLibrary = process.env.IMMICH_LIBRARY;
    const priorRoots = process.env.IMMICH_SCAN_ROOTS;
    process.env.IMMICH_LIBRARY = "/immich";
    process.env.IMMICH_SCAN_ROOTS = "/immich,/home/user/photos1";
    const map = resolveImmichPathMapSync();
    assert.equal(map.length, 2);
    assert.deepEqual(map[0], { from: "/data", to: "/immich" });
    assert.deepEqual(map[1], { from: "/home/user/photos1", to: "/home/user/photos1" });
    if (priorLibrary === undefined) delete process.env.IMMICH_LIBRARY;
    else process.env.IMMICH_LIBRARY = priorLibrary;
    if (priorRoots === undefined) delete process.env.IMMICH_SCAN_ROOTS;
    else process.env.IMMICH_SCAN_ROOTS = priorRoots;
  });
});
