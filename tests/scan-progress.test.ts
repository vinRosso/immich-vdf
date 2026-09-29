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

test("parseScanProgress shows reuse phase after skipped compare", () => {
  const reuse = parseScanProgress([
    "[scan] Library unchanged, reusing last compare.",
    "[scan] Finishing up…",
  ]);
  assert.equal(reuse.label, "Reusing last compare");
  assert.equal(reuse.indeterminate, true);
});

test("parseScanProgress shows post-compare phases", () => {
  const stuck = parseScanProgress([
    "[ 100%] 34654/34654 ETA 0m00s file.jpg  (comparing duplicates)",
    "Comparison complete",
  ]);
  assert.equal(stuck.indeterminate, true);
  assert.equal(stuck.label, "Finishing comparison");

  const saving = parseScanProgress([
    "[ 100%] 10/10 ETA 0m00s file.jpg  (comparing duplicates)",
    "[scan] Finishing up…",
    "[scan] Processing results…",
  ]);
  assert.equal(saving.label, "Processing results");
  assert.equal(saving.detail, "Reading file metadata…");
  assert.equal(saving.indeterminate, true);

  const paths = parseScanProgress([
    "[scan] Processing results…",
    "[scan] Processing results… 4000/20481 paths",
  ]);
  assert.equal(paths.detail, `${(4000).toLocaleString()} of ${(20481).toLocaleString()} paths`);
  assert.equal(paths.indeterminate, false);
  assert.equal(paths.percent, Math.round((4000 / 20481) * 100));

  const images = parseScanProgress([
    "[scan] Processing results… 20481/20481 paths",
    "[scan] Processing results… 200/20481 images",
  ]);
  assert.equal(images.detail, `${(200).toLocaleString()} of ${(20481).toLocaleString()} images`);
  assert.equal(images.indeterminate, false);
  assert.equal(images.percent, Math.round((200 / 20481) * 100));

  const immich = parseScanProgress([
    "[scan] Finishing up…",
    "[scan] Processing results…",
    "[scan] Matching Immich library…",
  ]);
  assert.equal(immich.label, "Matching Immich assets");
});
