import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import type { ImmichAssetTime } from "../src/lib/immich";
import type { InventoryEntry } from "../src/lib/scan-inventory";
import type { StoredGroup, StoredItem } from "../src/lib/types";

let dataDir = "";
let mod: typeof import("../src/lib/capture-times");

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "vdf-capture-"));
  process.env.DATA_DIR = dataDir;
  mod = await import("../src/lib/capture-times");
});

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const maps = [{ from: "/data", to: "/mnt/immich" }];

function entry(file: string, sizeBytes = 100, mtimeMs = 1000): InventoryEntry {
  return { path: file, sizeBytes, mtimeMs };
}

function asset(originalPath: string, fileCreatedAt: string, updatedAt = "2024-01-01T00:00:00.000Z"): ImmichAssetTime {
  return { originalPath, fileCreatedAt, updatedAt };
}

function sources(overrides: Partial<import("../src/lib/capture-times").CaptureSources> = {}) {
  const calls = { immich: [] as Array<string | undefined>, files: [] as string[][], log: [] as string[] };
  const value: import("../src/lib/capture-times").CaptureSources = {
    maps,
    listImmichTimes: async (updatedAfter) => {
      calls.immich.push(updatedAfter);
      return [];
    },
    readFileDates: async (files) => {
      calls.files.push(files);
      return new Map();
    },
    log: (line) => calls.log.push(line),
    ...overrides,
  };
  return { value, calls };
}

async function reset(): Promise<void> {
  await rm(path.join(dataDir, "immich-times.json"), { force: true });
  await rm(path.join(dataDir, "file-dates-server.json"), { force: true });
  await rm(path.join(dataDir, "file-dates-immich.json"), { force: true });
}

test("Immich's date is used first and files Immich does not know are read from the files", async () => {
  await reset();
  const { value, calls } = sources({
    listImmichTimes: async () => [asset("/data/library/a.jpg", "2020-05-01T10:00:00.000Z")],
    readFileDates: async (files) => {
      calls.files.push(files);
      return new Map([["/mnt/other/b.jpg", "2019-02-03T04:05:06.000Z"]]);
    },
  });
  const inventory = [entry("/mnt/immich/library/a.jpg"), entry("/mnt/other/b.jpg"), entry("/mnt/other/c.jpg")];

  const capture = await mod.collectCaptureTimes("server", inventory, value);

  assert.equal(capture.times.get("/mnt/immich/library/a.jpg"), "2020-05-01T10:00:00.000Z");
  assert.equal(capture.times.get("/mnt/other/b.jpg"), "2019-02-03T04:05:06.000Z");
  assert.equal(capture.times.has("/mnt/other/c.jpg"), false);
  assert.equal(capture.fromImmich, 1);
  assert.equal(capture.fromFiles, 1);
  assert.deepEqual(calls.files, [["/mnt/other/b.jpg", "/mnt/other/c.jpg"]]);
});

test("a date edited in Immich replaces the saved one, and only changes are asked for", async () => {
  await reset();
  const inventory = [entry("/mnt/immich/a.jpg")];
  const first = sources({
    listImmichTimes: async (updatedAfter) => {
      first.calls.immich.push(updatedAfter);
      return [asset("/data/a.jpg", "2020-05-01T10:00:00.000Z", "2024-03-01T12:00:00.000Z")];
    },
  });
  const before = await mod.collectCaptureTimes("immich", inventory, first.value);
  assert.deepEqual(first.calls.immich, [undefined]);

  const second = sources({
    listImmichTimes: async (updatedAfter) => {
      second.calls.immich.push(updatedAfter);
      return [asset("/data/a.jpg", "2021-12-24T18:00:00.000Z", "2024-04-01T09:00:00.000Z")];
    },
  });
  const after = await mod.collectCaptureTimes("immich", inventory, second.value);
  assert.deepEqual(second.calls.immich, ["2024-03-01T11:59:59.000Z"]);
  assert.equal(after.times.get("/mnt/immich/a.jpg"), "2021-12-24T18:00:00.000Z");
  assert.notEqual(after.fingerprint, before.fingerprint);

  const third = sources();
  const unchanged = await mod.collectCaptureTimes("immich", inventory, third.value);
  assert.deepEqual(third.calls.immich, ["2024-04-01T08:59:59.000Z"]);
  assert.equal(unchanged.fingerprint, after.fingerprint);
});

test("dates read from files are kept per file until the file changes", async () => {
  await reset();
  let reads = 0;
  const reader = async (files: string[]) => {
    reads += files.length;
    return new Map(files.filter((file) => file.endsWith("dated.jpg")).map((file) => [file, "2018-08-08T08:08:08.000Z"]));
  };
  const inventory = [entry("/mnt/other/dated.jpg"), entry("/mnt/other/plain.jpg")];

  const { value } = sources({ listImmichTimes: undefined, readFileDates: reader });
  const first = await mod.collectCaptureTimes("server", inventory, value);
  assert.equal(reads, 2);
  assert.equal(first.times.get("/mnt/other/dated.jpg"), "2018-08-08T08:08:08.000Z");

  // Neither file changed. A file with no date is remembered as having none.
  await mod.collectCaptureTimes("server", inventory, value);
  assert.equal(reads, 2);

  // One file was edited, so only that one is read again.
  const edited = [entry("/mnt/other/dated.jpg", 100, 5000), entry("/mnt/other/plain.jpg")];
  await mod.collectCaptureTimes("server", edited, value);
  assert.equal(reads, 3);
});

test("failing sources fall back to what is saved and never stop the scan", async () => {
  await reset();
  const inventory = [entry("/mnt/immich/a.jpg"), entry("/mnt/other/b.jpg")];
  const good = sources({
    listImmichTimes: async () => [asset("/data/a.jpg", "2020-05-01T10:00:00.000Z")],
    readFileDates: async () => {
      throw new Error("not yet");
    },
  });
  await mod.collectCaptureTimes("server", inventory, good.value);

  const broken = sources({
    listImmichTimes: async () => {
      throw new Error("Immich search failed (500)");
    },
    readFileDates: async () => {
      throw new Error("vdf-cli exited with code 1");
    },
  });
  const capture = await mod.collectCaptureTimes("server", inventory, broken.value);
  assert.equal(capture.times.get("/mnt/immich/a.jpg"), "2020-05-01T10:00:00.000Z");
  assert.equal(capture.times.has("/mnt/other/b.jpg"), false);
  assert.ok(broken.calls.log.some((line) => /Could not read capture dates from Immich \(Immich search failed \(500\)\)/.test(line)));
  assert.ok(broken.calls.log.some((line) => /Could not read capture dates from files \(vdf-cli exited with code 1\)/.test(line)));

  // The failed read was not saved as "no date", so a later run tries again.
  const retry = sources({ readFileDates: async (files) => new Map(files.map((file) => [file, "2017-01-01T00:00:00.000Z"])) });
  const later = await mod.collectCaptureTimes("server", inventory, retry.value);
  assert.equal(later.times.get("/mnt/other/b.jpg"), "2017-01-01T00:00:00.000Z");
});

test("the fingerprint follows the dates, not the order of the work", async () => {
  await reset();
  const dates = new Map([
    ["/mnt/other/a.jpg", "2020-01-01T00:00:00.000Z"],
    ["/mnt/other/b.jpg", "2020-01-02T00:00:00.000Z"],
  ]);
  const reader = async (files: string[]) => new Map(files.filter((f) => dates.has(f)).map((f) => [f, dates.get(f)!]));
  const { value } = sources({ listImmichTimes: undefined, readFileDates: reader });
  const inventory = [entry("/mnt/other/a.jpg"), entry("/mnt/other/b.jpg")];

  const first = await mod.collectCaptureTimes("server", inventory, value);
  const again = await mod.collectCaptureTimes("server", inventory, value);
  assert.equal(first.fingerprint, again.fingerprint);

  dates.set("/mnt/other/b.jpg", "2020-03-03T00:00:00.000Z");
  const edited = await mod.collectCaptureTimes("server", [entry("/mnt/other/a.jpg"), entry("/mnt/other/b.jpg", 100, 2000)], value);
  assert.notEqual(edited.fingerprint, first.fingerprint);
});

test("the saved Immich dates live in the data folder", async () => {
  await reset();
  const { value } = sources({ listImmichTimes: async () => [asset("/data/a.jpg", "2020-05-01T10:00:00.000Z")] });
  await mod.collectCaptureTimes("server", [entry("/mnt/immich/a.jpg")], value);
  const saved = JSON.parse(await readFile(path.join(dataDir, "immich-times.json"), "utf8")) as {
    updatedAfter: string;
    byPath: Record<string, string>;
  };
  assert.equal(saved.byPath["/data/a.jpg"], "2020-05-01T10:00:00.000Z");
  assert.equal(saved.updatedAfter, "2024-01-01T00:00:00.000Z");
});

function item(file: string, dateCreatedMs = 0): StoredItem {
  return {
    path: file,
    similarity: 1,
    sizeBytes: 1,
    durationSeconds: 0,
    resolution: null,
    width: 0,
    height: 0,
    bitrateKbps: 0,
    bitDepth: 0,
    audioBitrateKbps: 0,
    dateCreatedMs,
    flags: [],
    partialClipOffsetSeconds: 0,
    isImage: true,
    format: null,
    fps: 0,
    assetId: null,
    originalPath: null,
    stackId: null,
    stackPrimary: false,
  };
}

test("capture dates are put on result items and on the burst image list", async () => {
  await reset();
  const { value } = sources({ listImmichTimes: undefined, readFileDates: async () => new Map([["/mnt/other/a.jpg", "2020-01-02T03:04:05.000Z"]]) });
  const capture = await mod.collectCaptureTimes("server", [entry("/mnt/other/a.jpg")], value);

  const groups: StoredGroup[] = [{ groupId: "g", items: [item("/mnt/other/a.jpg", 5), item("/mnt/other/z.jpg", 7)] }];
  const [group] = mod.applyCaptureDates(groups, capture);
  assert.equal(group.items[0].dateCreatedMs, Date.parse("2020-01-02T03:04:05.000Z"));
  assert.equal(group.items[1].dateCreatedMs, 7);
  assert.equal(mod.applyCaptureDates(groups, null), groups);

  const images = mod.applyCaptureDatesToImages(
    [
      { path: "/mnt/other/a.jpg", dateCreatedMs: 1, sizeBytes: 1 },
      { path: "/mnt/other/z.jpg", dateCreatedMs: 2, sizeBytes: 1 },
    ],
    capture,
  );
  assert.deepEqual(images.map((image) => image.dateCreatedMs), [Date.parse("2020-01-02T03:04:05.000Z"), 2]);
});

test("burst groups and the window decide whether capture dates are read", () => {
  assert.equal(mod.needsCaptureDates({ timeWindowDays: 0, prefixSeconds: 0, includeImages: true }), false);
  assert.equal(mod.needsCaptureDates({ timeWindowDays: 7, prefixSeconds: 0, includeImages: false }), true);
  assert.equal(mod.needsCaptureDates({ timeWindowDays: 0, prefixSeconds: 5, includeImages: true }), true);
  assert.equal(mod.needsCaptureDates({ timeWindowDays: 0, prefixSeconds: 5, includeImages: false }), false);
  assert.equal(mod.prefixCacheKey("library", null), "library");
  assert.equal(mod.prefixCacheKey("library", { fingerprint: "dates" } as import("../src/lib/capture-times").CaptureTimes), "library:dates");
});

test("dates saved for another Immich server are not used", async () => {
  await reset();
  const inventory = [entry("/mnt/immich/a.jpg")];
  const home = sources({
    immichBaseUrl: "http://home:2283",
    listImmichTimes: async () => [asset("/data/a.jpg", "2020-05-01T10:00:00.000Z")],
  });
  await mod.collectCaptureTimes("immich", inventory, home.value);

  const other = sources({ immichBaseUrl: "http://other:2283", listImmichTimes: async (updatedAfter) => {
    other.calls.immich.push(updatedAfter);
    return [];
  } });
  const switched = await mod.collectCaptureTimes("immich", inventory, other.value);
  assert.deepEqual(other.calls.immich, [undefined], "everything is asked for again");
  assert.equal(switched.times.has("/mnt/immich/a.jpg"), false);
});

test("every asset is listed again after a week, so moved and deleted ones are forgotten", async () => {
  await reset();
  const inventory = [entry("/mnt/immich/gone.jpg"), entry("/mnt/immich/kept.jpg")];
  let clock = Date.parse("2026-10-01T00:00:00.000Z");
  const list = [
    asset("/data/gone.jpg", "2020-01-01T00:00:00.000Z"),
    asset("/data/kept.jpg", "2021-01-01T00:00:00.000Z"),
  ];
  const first = sources({ now: () => clock, listImmichTimes: async () => list });
  await mod.collectCaptureTimes("immich", inventory, first.value);

  // Two days later only changes are asked for, and the deleted asset is still remembered.
  clock += 2 * 24 * 60 * 60 * 1000;
  const soon = sources({ now: () => clock });
  const within = await mod.collectCaptureTimes("immich", inventory, soon.value);
  assert.notEqual(soon.calls.immich[0], undefined);
  assert.equal(within.times.has("/mnt/immich/gone.jpg"), true);

  // A week on, everything is listed again and the asset that left Immich is dropped.
  clock += 6 * 24 * 60 * 60 * 1000;
  const later = sources({ now: () => clock, listImmichTimes: async (updatedAfter) => {
    later.calls.immich.push(updatedAfter);
    return [list[1]!];
  } });
  const refreshed = await mod.collectCaptureTimes("immich", inventory, later.value);
  assert.deepEqual(later.calls.immich, [undefined]);
  assert.equal(refreshed.times.has("/mnt/immich/gone.jpg"), false);
  assert.equal(refreshed.times.get("/mnt/immich/kept.jpg"), "2021-01-01T00:00:00.000Z");
});
