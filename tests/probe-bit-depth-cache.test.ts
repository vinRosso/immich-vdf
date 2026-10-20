import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

let dataDir = "";
let probe: typeof import("../src/lib/probe");

// A JPEG whose header says 12 bits per sample.
const jpeg12 = Buffer.from([
  0xff, 0xd8,
  0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x0b, 0x0c, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x00,
]);

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "vdf-depth-"));
  process.env.DATA_DIR = dataDir;
  probe = await import("../src/lib/probe");
});

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function sidecar(file: string, bitDepth: number): Promise<string> {
  const key = await probe.fileCacheKey(file);
  const dir = path.join(dataDir, "probe");
  await mkdir(dir, { recursive: true });
  const depthPath = path.join(dir, `${key}.depth.json`);
  await writeFile(depthPath, JSON.stringify({ bitDepth }));
  return depthPath;
}

test("a file saved as unreadable is not opened again", async () => {
  const file = path.join(dataDir, "unreadable.jpg");
  await writeFile(file, jpeg12);
  // The file could be read, so only the saved answer explains getting 0 back.
  await sidecar(file, 0);
  assert.equal(await probe.probeImageBitDepth(file, { ffprobe: false }), 0);
  assert.equal(await probe.probeImageBitDepth(file), 0);
});

test("a changed file is read again", async () => {
  const file = path.join(dataDir, "changed.jpg");
  await writeFile(file, jpeg12);
  await sidecar(file, 0);
  assert.equal(await probe.probeImageBitDepth(file, { ffprobe: false }), 0);
  // Another size gives another cache key, so the saved zero no longer applies.
  await writeFile(file, Buffer.concat([jpeg12, Buffer.from([0x00])]));
  assert.equal(await probe.probeImageBitDepth(file, { ffprobe: false }), 12);
});

test("a header that can be read is saved and used next time", async () => {
  const file = path.join(dataDir, "fresh.jpg");
  await writeFile(file, jpeg12);
  assert.equal(await probe.probeImageBitDepth(file, { ffprobe: false }), 12);
  assert.equal(await probe.probeImageBitDepth(file, { ffprobe: false }), 12);
});
