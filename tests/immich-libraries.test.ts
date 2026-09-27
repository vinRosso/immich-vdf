import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importPathsFromLibraries } from "../src/lib/immich";

describe("importPathsFromLibraries", () => {
  it("collects unique import paths from library records", () => {
    const paths = importPathsFromLibraries([
      { importPaths: ["/home/user/photos1", "/home/user/photos2"] },
      { importPaths: ["/home/user/photos1"] },
      { name: "empty" },
    ]);
    assert.deepEqual(paths, ["/home/user/photos1", "/home/user/photos2"]);
  });
});
