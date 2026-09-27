import assert from "node:assert/strict";
import test from "node:test";
import { parseScanProgress } from "../src/lib/scan-progress";

test("parseScanProgress reads the latest percent line", () => {
  const info = parseScanProgress([
    "[scan] File enumeration complete.",
    "[  0%] 0/667 ETA ... file.png",
    "[  3%] 22/667 ETA 0m10s file2.png",
  ]);
  assert.equal(info.percent, 3);
  assert.equal(info.label, "Hashing files");
  assert.equal(info.detail, "22 of 667");
});

test("parseScanProgress detects comparing stage", () => {
  const info = parseScanProgress([
    "[scan] File enumeration complete.",
    "[ 50%] 300/600 ETA 0m05s clip.mp4",
    "[  2%] 10/500 ETA 0m08s item.mkv  (comparing duplicates)",
  ]);
  assert.equal(info.percent, 2);
  assert.equal(info.label, "Comparing duplicates");
});
