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

  const prefix = parseScanProgress([
    "[ 100%] 10/10 ETA 0m00s file.jpg  (comparing duplicates)",
    "Comparison complete",
    "[scan] Finishing up…",
    "[scan] Grouping images by file name and time…",
  ]);
  assert.equal(prefix.label, "Grouping by name and time");
  assert.equal(prefix.indeterminate, true);
});

test("parseScanProgress shows the newest server step, not the first in the list", () => {
  const afterGrouping = parseScanProgress([
    "[scan] Finishing up…",
    "[scan] Grouping images by file name and time (up to 4 workers, one prefix each)…",
    "[scan] Processing results… 10/20 paths",
  ]);
  assert.equal(afterGrouping.label, "Processing results");

  const grouping = parseScanProgress([
    "[scan] Finishing up…",
    "[scan] Processing results…",
    "[scan] Grouping images by file name and time (up to 4 workers, one prefix each)…",
  ]);
  assert.equal(grouping.label, "Grouping by name and time");
});

test("parseScanProgress names the library check and gives way to CLI progress", () => {
  const checking = parseScanProgress(["[scan] Checking whether the library changed…"]);
  assert.equal(checking.label, "Checking the library");
  assert.equal(checking.indeterminate, true);

  const hashing = parseScanProgress([
    "[scan] Checking whether the library changed…",
    "[scan] Inventory took 3.1 s",
    "[scan] 2 files changed, comparing the library.",
    "[scan] File enumeration complete.",
    "[ 40%] 8/20 ETA 0m04s file.mp4",
  ]);
  assert.equal(hashing.label, "Hashing files");
  assert.equal(hashing.percent, 40);
});

test("parseScanProgress reports Immich asset and stack steps", () => {
  const assets = parseScanProgress(["[scan] Matching Immich library… 200/3000 assets"]);
  assert.equal(assets.label, "Matching Immich assets");
  assert.equal(assets.detail, `${(200).toLocaleString()} of ${(3000).toLocaleString()} assets`);
  assert.equal(assets.indeterminate, false);

  const stacks = parseScanProgress(["[scan] Matching Immich library…", "[scan] Reading Immich stacks…"]);
  assert.equal(stacks.label, "Reading Immich stacks");
});

test("parseScanProgress names the capture date step", () => {
  const info = parseScanProgress([
    "[scan] Checking whether the library changed…",
    "[scan] Inventory took 1.0 s",
    "[scan] Reading capture dates from Immich…",
  ]);
  assert.equal(info.label, "Reading capture dates");
  assert.equal(info.indeterminate, true);
});

test("parseScanProgress shows the AI embedding stage instead of a stuck 1 of 1 hashing bar", () => {
  const info = parseScanProgress([
    "[scan] File enumeration complete.",
    "[ 99%] 35340/35349  ETA 0m03s  ...x.jpg    ",
    "[100%] 1/1  ETA ...    (computing AI embeddings)    ",
  ]);
  assert.equal(info.label, "Computing AI embeddings");
  assert.equal(info.indeterminate, true);
});

test("parseScanProgress says the comparison is being prepared once hashing is over", () => {
  const preparing = parseScanProgress([
    "[scan] File enumeration complete.",
    "[100%] 1/1  ETA ...    (computing AI embeddings)    [scan] Hashing complete.",
  ]);
  assert.equal(preparing.label, "Preparing comparison");
  assert.equal(preparing.indeterminate, true);

  const comparing = parseScanProgress([
    "[100%] 1/1  ETA ...    (computing AI embeddings)    [scan] Hashing complete.",
    "[  0%] 0/34846  ETA ...    (comparing duplicates)    ",
  ]);
  assert.equal(comparing.label, "Comparing duplicates");
});

test("parseScanProgress names the partial clip stages and counts them", () => {
  const info = parseScanProgress([
    "[100%] 34846/34846  ETA ...    (comparing duplicates)    ",
    "[ 10%] 5/50  ETA 1m00s    (AI partial: sampling keyframes)    ",
  ]);
  assert.equal(info.label, "Finding partial clips with AI");
  assert.equal(info.detail, "5 of 50");
  assert.equal(info.indeterminate, false);
  assert.equal(info.percent, 10);

  const validating = parseScanProgress(["[ 50%] 10/20  ETA 0m05s    (validating duplicate groups)    "]);
  assert.equal(validating.label, "Checking duplicate groups");
});

test("parseScanProgress is not fooled by a file name in parentheses", () => {
  const info = parseScanProgress([
    "[scan] File enumeration complete.",
    "[ 40%] 8/20  ETA 0m04s  ...holiday (1).mp4  (sampling frames 2/5)    ",
  ]);
  assert.equal(info.label, "Hashing files");
  assert.equal(info.detail, "8 of 20");
});
