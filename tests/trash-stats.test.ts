import assert from "node:assert/strict";
import test from "node:test";
import { trashStatsSavedTotal } from "../src/lib/store";

test("trashStatsSavedTotal sums server freed and Immich trashed bytes", () => {
  assert.equal(trashStatsSavedTotal({ bytesFreed: 100, immichBytesTrashed: 50 }), 150);
  assert.equal(trashStatsSavedTotal({ bytesFreed: 100 }), 100);
});
