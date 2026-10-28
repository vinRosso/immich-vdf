import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function item(file: string, assetId: string | null) {
  return {
    path: file,
    similarity: 99,
    sizeBytes: 10,
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
    assetId,
    originalPath: null,
  };
}

async function writeResults(dir: string, section: string, groups: { groupId: string; items: ReturnType<typeof item>[] }[]) {
  await mkdir(path.join(dir, "results"), { recursive: true });
  await writeFile(
    path.join(dir, "results", `${section}.json`),
    JSON.stringify({ finishedAt: "2026-01-01T00:00:00Z", error: null, warning: null, groups }),
  );
}

function epoch(section: string): number {
  const holder = globalThis as typeof globalThis & { __vdfWriteEpoch?: Map<string, number> };
  return holder.__vdfWriteEpoch?.get(section) ?? 0;
}

test("bulk stack saves the groups that worked, lists the one that failed and writes once", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vdf-bulk-"));
  process.env.DATA_DIR = dir;
  await writeFile(
    path.join(dir, "settings.json"),
    JSON.stringify({ immich: { baseUrl: "http://8.8.8.8", apiKey: "key" } }),
  );
  const make = (id: string) => ({ groupId: id, items: ["1", "2", "3"].map((n) => item(`/lib/${id}-${n}.jpg`, `${id}-${n}`)) });
  await writeResults(dir, "immich", [make("g1"), make("g2"), make("g3")]);

  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls += 1;
    const assetIds = (JSON.parse(String(init?.body)) as { assetIds: string[] }).assetIds;
    if (assetIds[0].startsWith("g2")) return new Response("no", { status: 500 });
    return Response.json({
      id: `stack-${assetIds[0]}`,
      primaryAssetId: assetIds[0],
      assets: assetIds.map((id) => ({ id, originalPath: `/lib/${id}.jpg` })),
    });
  }) as typeof fetch;
  try {
    const { stackImmichGroups, resultsPatch } = await import("../src/lib/actions");
    const before = epoch("immich");
    const outcome = await stackImmichGroups([
      { groupId: "g1", primaryId: "g1-1" },
      { groupId: "g2", primaryId: "g2-1" },
      { groupId: "g3", primaryId: "g3-1" },
    ]);
    assert.equal(calls, 3);
    assert.deepEqual(outcome.failed.map((entry) => entry.groupId), ["g2"]);
    assert.deepEqual([...outcome.touched].sort(), ["g1", "g3"]);
    assert.equal(epoch("immich") - before, 1);
    const saved = JSON.parse(await readFile(path.join(dir, "results", "immich.json"), "utf8")) as { groups: { groupId: string }[] };
    assert.deepEqual(saved.groups.map((group) => group.groupId), ["g2"]);
    // A group that is now one complete stack leaves the list, so the patch reports it as removed.
    const patch = await resultsPatch("immich", ["g1", "g2", "g3"]);
    assert.deepEqual([...patch.removedIds].sort(), ["g1", "g3"]);
    assert.deepEqual(patch.groups.map((group) => group.groupId), ["g2"]);
  } finally {
    globalThis.fetch = original;
  }
});

test("bulk trash on Files moves every copy at once with one undo record", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vdf-bulk-"));
  const media = await realpath(await mkdtemp(path.join(os.tmpdir(), "vdf-media-")));
  process.env.DATA_DIR = dir;
  process.env.MEDIA_ROOTS = media;
  const files = ["a1", "a2", "b1", "b2"].map((name) => path.join(media, `${name}.jpg`));
  for (const file of files) await writeFile(file, "x");
  await writeResults(dir, "server", [
    { groupId: "ga", items: [item(files[0], null), item(files[1], null)] },
    { groupId: "gb", items: [item(files[2], null), item(files[3], null)] },
    { groupId: "gc", items: [item(path.join(media, "missing.jpg"), null), item(files[3], null)] },
  ]);
  const { trashServerGroups, resultsPatch } = await import("../src/lib/actions");
  const outcome = await trashServerGroups([
    { groupId: "ga", keepPath: files[0] },
    { groupId: "gb", keepPath: files[2] },
    { groupId: "nope", keepPath: files[2] },
  ]);
  assert.equal(outcome.moved, 2);
  assert.ok(outcome.undoId);
  assert.deepEqual(outcome.failed.map((entry) => entry.groupId), ["nope"]);
  assert.ok(existsSync(files[0]) && existsSync(files[2]));
  assert.ok(!existsSync(files[1]) && !existsSync(files[3]));
  const patch = await resultsPatch("server", outcome.touched);
  assert.deepEqual([...patch.removedIds].sort(), ["ga", "gb"]);
});

test("one file that cannot be moved does not lose the undo for the files that were", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vdf-bulk-"));
  const media = await realpath(await mkdtemp(path.join(os.tmpdir(), "vdf-media-")));
  process.env.DATA_DIR = dir;
  process.env.MEDIA_ROOTS = media;
  const files = ["a1", "a2", "b1", "b2"].map((name) => path.join(media, `${name}.jpg`));
  for (const file of files.slice(0, 3)) await writeFile(file, "x");
  await writeResults(dir, "server", [
    { groupId: "ga", items: [item(files[0], null), item(files[1], null)] },
    { groupId: "gb", items: [item(files[2], null), item(files[3], null)] },
  ]);
  const { trashServerGroups, resultsPatch } = await import("../src/lib/actions");
  const outcome = await trashServerGroups([
    { groupId: "ga", keepPath: files[0] },
    { groupId: "gb", keepPath: files[2] },
  ]);
  assert.equal(outcome.moved, 1);
  assert.ok(outcome.undoId);
  assert.equal(outcome.unmoved, 1);
  assert.ok(!existsSync(files[1]));
  const patch = await resultsPatch("server", ["ga", "gb"]);
  assert.deepEqual(patch.removedIds, ["ga"]);
});

test("a patch carries the results it was built from", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vdf-bulk-"));
  process.env.DATA_DIR = dir;
  await writeResults(dir, "server", [{ groupId: "ga", items: [item("/m/a1.jpg", null), item("/m/a2.jpg", null)] }]);
  const { resultsPatch } = await import("../src/lib/actions");
  assert.equal((await resultsPatch("server", ["ga"])).finishedAt, "2026-01-01T00:00:00Z");
});
