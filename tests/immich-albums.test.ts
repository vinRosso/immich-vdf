import test from "node:test";
import assert from "node:assert/strict";
import { parseAlbumList } from "../src/lib/immich";

test("parseAlbumList reads album names from Immich responses", () => {
  assert.deepEqual(
    parseAlbumList([
      { id: "a1", albumName: "Concert" },
      { id: "a2", name: "Family" },
      { id: "a3" },
    ]),
    [
      { id: "a1", name: "Concert" },
      { id: "a2", name: "Family" },
    ],
  );
});
