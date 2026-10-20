import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultScan } from "../src/lib/scan-defaults";
import { isScannedMedia } from "../src/lib/media-extensions";
import { fingerprintMatchingSettings, walkScanInventory } from "../src/lib/scan-inventory";

async function library(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vdf-inventory-"));
  await mkdir(path.join(root, "trips", "2024"), { recursive: true });
  await mkdir(path.join(root, ".vdf-trash", "trips"), { recursive: true });
  await writeFile(path.join(root, "clip.MP4"), "video");
  await writeFile(path.join(root, "notes.txt"), "text");
  await writeFile(path.join(root, "clip.xmp"), "sidecar");
  await writeFile(path.join(root, "trips", "2024", "beach.jpg"), "image");
  await writeFile(path.join(root, "trips", "2024", "beach.mov"), "video");
  await writeFile(path.join(root, ".vdf-trash", "trips", "old.mp4"), "video");
  return root;
}

function names(entries: { path: string }[], root: string): string[] {
  return entries.map((entry) => path.relative(root, entry.path).split(path.sep).join("/"));
}

test("inventory lists only media files and sorts by path", async () => {
  const root = await library();
  try {
    const entries = await walkScanInventory([root], [], { includeImages: true });
    assert.deepEqual(names(entries, root), [
      ".vdf-trash/trips/old.mp4",
      "clip.MP4",
      "trips/2024/beach.jpg",
      "trips/2024/beach.mov",
    ]);
    assert.ok(entries.every((entry) => entry.sizeBytes > 0 && entry.mtimeMs > 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inventory skips images when the scan only reads videos", async () => {
  const root = await library();
  try {
    const entries = await walkScanInventory([root], [], { includeImages: false });
    assert.deepEqual(names(entries, root), [".vdf-trash/trips/old.mp4", "clip.MP4", "trips/2024/beach.mov"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inventory leaves out excluded folders", async () => {
  const root = await library();
  try {
    const entries = await walkScanInventory([root], [path.join(root, ".vdf-trash")], { includeImages: true });
    assert.deepEqual(names(entries, root), ["clip.MP4", "trips/2024/beach.jpg", "trips/2024/beach.mov"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inventory stops when asked to abort", async () => {
  const root = await library();
  try {
    const entries = await walkScanInventory([root], [], { shouldAbort: () => true });
    assert.deepEqual(entries, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inventory ends a symlink loop", async (t) => {
  const root = await library();
  try {
    try {
      await symlink(root, path.join(root, "trips", "loop"), "junction");
    } catch {
      t.skip("symlinks are not allowed here");
      return;
    }
    const entries = await walkScanInventory([root], [], { includeImages: true });
    const real = names(entries, root).filter((name) => !name.includes("loop/"));
    assert.deepEqual(real, [".vdf-trash/trips/old.mp4", "clip.MP4", "trips/2024/beach.jpg", "trips/2024/beach.mov"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("media check matches the engine's lists", () => {
  assert.equal(isScannedMedia("a.MKV", false), true);
  assert.equal(isScannedMedia("a.heic", false), false);
  assert.equal(isScannedMedia("a.heic", true), true);
  assert.equal(isScannedMedia("a.json", true), false);
  assert.equal(isScannedMedia(".mp4", true), false);
});

test("changing parallelism does not change the matching fingerprint", () => {
  const scan = defaultScan();
  assert.equal(fingerprintMatchingSettings({ ...scan, parallelism: scan.parallelism + 3 }), fingerprintMatchingSettings(scan));
  assert.notEqual(fingerprintMatchingSettings({ ...scan, percent: scan.percent - 1 }), fingerprintMatchingSettings(scan));
});
