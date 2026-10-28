import assert from "node:assert/strict";
import test from "node:test";
import { thumbPriority } from "../src/server/raw";

test("the prefetch header puts a thumbnail request in the prefetch lane, whatever the query says", () => {
  assert.equal(thumbPriority("1", "thumb"), "prefetch");
  assert.equal(thumbPriority("1", null), "prefetch");
});

test("without the header the query picks the lane", () => {
  assert.equal(thumbPriority(undefined, "thumb"), "thumb");
  assert.equal(thumbPriority(undefined, "viewer"), "thumb");
  assert.equal(thumbPriority(undefined, "strip"), "strip");
  assert.equal(thumbPriority(undefined, null), "thumbnail");
  assert.equal(thumbPriority(undefined, "prefetch"), "thumbnail");
  assert.equal(thumbPriority("0", "strip"), "strip");
});
