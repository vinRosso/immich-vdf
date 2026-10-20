import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";

function group(id: string) {
  return {
    groupId: id,
    items: [1, 2].map((n) => ({
      path: `/media/${id}-${n}.jpg`,
      similarity: 99,
      sizeBytes: 10 * n,
      durationSeconds: 0,
      resolution: null,
      width: 1,
      height: 1,
      bitrateKbps: 0,
      bitDepth: 8,
      audioBitrateKbps: 0,
      dateCreatedMs: 0,
      flags: [],
      partialClipOffsetSeconds: 0,
      isImage: true,
      format: null,
      fps: 0,
      assetId: null,
      originalPath: null,
    })),
  };
}

async function writeResults(dir: string, ids: string[]) {
  await mkdir(path.join(dir, "results"), { recursive: true });
  await writeFile(
    path.join(dir, "results", "server.json"),
    JSON.stringify({ finishedAt: "2026-01-01T00:00:00Z", error: null, warning: null, groups: ids.map(group) }),
  );
}

test("the results view is reused until the results file changes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vdf-results-"));
  process.env.DATA_DIR = dir;
  const { resultsView, resultsViewGzip } = await import("../src/lib/actions");
  await writeResults(dir, ["a", "b"]);
  const first = await resultsView("server");
  assert.equal(first.groups.length, 2);
  assert.equal(await resultsView("server"), first);

  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeResults(dir, ["a", "b", "c"]);
  const second = await resultsView("server");
  assert.notEqual(second, first);
  assert.equal(second.groups.length, 3);

  const zipped = await resultsViewGzip("server");
  assert.equal(await resultsViewGzip("server"), zipped);
  assert.equal(JSON.parse(gunzipSync(zipped).toString("utf8")).groups.length, 3);
});

test("the ignore list change also refreshes the view", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vdf-results-"));
  process.env.DATA_DIR = dir;
  const { resultsView } = await import("../src/lib/actions");
  await writeResults(dir, ["a", "b"]);
  const before = await resultsView("server");
  await new Promise((resolve) => setTimeout(resolve, 20));
  await mkdir(path.join(dir, "ignore"), { recursive: true });
  await writeFile(path.join(dir, "ignore", "server.json"), "[]\n");
  assert.notEqual(await resultsView("server"), before);
});
