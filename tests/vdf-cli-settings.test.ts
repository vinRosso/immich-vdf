import assert from "node:assert/strict";
import test from "node:test";
import { buildVdfArgs, buildVdfCompareArgs, buildVdfExifArgs, buildVdfScanArgs } from "../src/lib/cli-args";
import { defaultScan } from "../src/lib/scan-defaults";
import { buildVdfCliSettingsFile } from "../src/lib/vdf-cli-settings";

test("vdf-cli settings file uses VDF.Core field names", () => {
  const scan = {
    ...defaultScan(),
    compareHorizontallyFlipped: true,
    ignoreBlackPixels: true,
    ignoreWhitePixels: false,
  };
  assert.deepEqual(buildVdfCliSettingsFile(scan), {
    IncludeSubDirectories: true,
    CompareHorizontallyFlipped: true,
    IgnoreBlackPixels: true,
    IgnoreWhitePixels: false,
    HddMaxDegreeOfParallelism: scan.parallelism,
  });
});

test("slow drives are read at the user's Parallel value, at least 1", () => {
  assert.equal(buildVdfCliSettingsFile({ ...defaultScan(), parallelism: 15 }).HddMaxDegreeOfParallelism, 15);
  assert.equal(buildVdfCliSettingsFile({ ...defaultScan(), parallelism: 0 }).HddMaxDegreeOfParallelism, 1);
});

test("vdf-cli settings file carries the folder scope for compare", () => {
  const file = buildVdfCliSettingsFile(defaultScan(), {
    includes: ["/media/a", "/media/b"],
    excludes: ["/media/a/skip"],
  });
  assert.deepEqual(file.IncludeList, ["/media/a", "/media/b"]);
  assert.deepEqual(file.BlackList, ["/media/a/skip"]);
});

test("buildVdfArgs passes --settings path", () => {
  const args = buildVdfArgs({
    ...defaultScan(),
    includes: ["/media/a"],
    excludes: [],
    dbDir: "/data/db/server",
    outputFile: "/data/tmp/out.json",
    settingsFile: "/data/tmp/settings.json",
  });
  assert.equal(args[args.indexOf("--settings") + 1], "/data/tmp/settings.json");
});

test("buildVdfScanArgs uses scan without json output", () => {
  const args = buildVdfScanArgs({
    ...defaultScan(),
    includes: ["/media/a"],
    excludes: ["/media/a/skip"],
    dbDir: "/data/db/server",
    settingsFile: "/data/tmp/settings.json",
  });
  assert.equal(args[0], "scan");
  assert.equal(args.includes("--format"), false);
  assert.equal(args[args.indexOf("--include") + 1], "/media/a");
});

test("buildVdfCompareArgs uses compare with json output", () => {
  const args = buildVdfCompareArgs({
    ...defaultScan(),
    dbDir: "/data/db/server",
    outputFile: "/data/tmp/out.json",
    settingsFile: "/data/tmp/settings.json",
  });
  assert.equal(args[0], "compare");
  assert.equal(args[args.indexOf("--format") + 1], "json");
  assert.equal(args[args.indexOf("--output") + 1], "/data/tmp/out.json");
  assert.equal(args.includes("--include"), false);
});

test("buildVdfCompareArgs passes the capture dates only when the window is on", () => {
  const base = {
    ...defaultScan(),
    dbDir: "/data/db/server",
    outputFile: "/data/tmp/out.json",
    settingsFile: "/data/tmp/settings.json",
    timesFile: "/data/tmp/times.json",
  };
  const windowed = buildVdfCompareArgs({ ...base, timeWindowDays: 7 });
  assert.equal(windowed[windowed.indexOf("--times") + 1], "/data/tmp/times.json");
  assert.equal(buildVdfCompareArgs({ ...base, timeWindowDays: 0 }).includes("--times"), false);
  assert.equal(buildVdfCompareArgs({ ...base, timeWindowDays: 7, timesFile: undefined }).includes("--times"), false);
});

test("buildVdfExifArgs lists the files and sets the parallelism", () => {
  assert.deepEqual(buildVdfExifArgs("/tmp/list.txt", "/tmp/out.json", 4), [
    "exif", "--paths", "/tmp/list.txt", "--output", "/tmp/out.json", "--parallelism", "4",
  ]);
  assert.equal(buildVdfExifArgs("a", "b", 0).at(-1), "1");
});

test("scan-and-compare passes the capture dates only when the window is on, and native only when asked", () => {
  const base = {
    ...defaultScan(),
    includes: ["/media/a"],
    excludes: ["/media/a/skip"],
    dbDir: "/data/db/server",
    outputFile: "/data/tmp/out.json",
    settingsFile: "/data/tmp/settings.json",
    timesFile: "/data/tmp/times.json",
  };
  const windowed = buildVdfArgs({ ...base, timeWindowDays: 7, nativeFfmpeg: true });
  assert.equal(windowed[0], "scan-and-compare");
  assert.equal(windowed[windowed.indexOf("--times") + 1], "/data/tmp/times.json");
  assert.equal(windowed.includes("--native-ffmpeg"), true);
  assert.equal(windowed[windowed.indexOf("--include") + 1], "/media/a");
  const plain = buildVdfArgs({ ...base, timeWindowDays: 0 });
  assert.equal(plain.includes("--times"), false);
  assert.equal(plain.includes("--native-ffmpeg"), false);
});
