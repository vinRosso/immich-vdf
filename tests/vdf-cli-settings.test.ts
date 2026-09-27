import assert from "node:assert/strict";
import test from "node:test";
import { buildVdfArgs } from "../src/lib/cli-args";
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
