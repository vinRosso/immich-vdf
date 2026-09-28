import assert from "node:assert/strict";
import test from "node:test";
import { buildVdfArgs, buildVdfCompareArgs, buildVdfScanArgs } from "../src/lib/cli-args";
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
  });
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
