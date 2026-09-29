import assert from "node:assert/strict";
import test from "node:test";
import { formatScanDuration } from "../src/lib/format";

test("scan duration reads as hours, minutes, and seconds", () => {
  assert.equal(formatScanDuration(0), "0s");
  assert.equal(formatScanDuration(400), "under 1m");
  assert.equal(formatScanDuration(45_000), "45s");
  assert.equal(formatScanDuration(12 * 60_000 + 4_000), "12m 4s");
  assert.equal(formatScanDuration(60 * 60_000), "1h");
  assert.equal(formatScanDuration(60 * 60_000 + 23 * 60_000), "1h 23m");
});
