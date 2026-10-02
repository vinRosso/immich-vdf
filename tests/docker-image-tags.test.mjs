import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dockerTagSuffixes, qualifyImageTags } from "../scripts/docker-image-tags.mjs";

const script = fileURLToPath(new URL("../scripts/docker-image-tags.mjs", import.meta.url));

test("a pushed release tag publishes that version, its minor, its major, and latest", () => {
  assert.deepEqual(dockerTagSuffixes(["v9.9.9"], { only: "v0.1.0" }), ["0.1.0", "0.1", "0", "latest"]);
  assert.deepEqual(dockerTagSuffixes([], { only: "v1.2.3" }), ["1.2.3", "1.2", "1", "latest"]);
});

test("a manual run uses the highest release tag", () => {
  assert.deepEqual(dockerTagSuffixes(["v0.1.0", "v0.1.10", "v0.2.0", "v0.10.0", "v0.9.0", "v1.0.0-rc1"]), [
    "0.10.0",
    "0.10",
    "0",
    "latest",
  ]);
});

test("a manual run with no release tag publishes latest only", () => {
  assert.deepEqual(dockerTagSuffixes(["v0.1", "latest", "v1.0.0-rc1"]), ["latest"]);
  assert.deepEqual(dockerTagSuffixes([]), ["latest"]);
});

test("a tag push that is not a release fails", () => {
  assert.throws(() => dockerTagSuffixes([], { only: "v0.1" }), /v0\.1\.0/);
});

test("image tags stay comma-free and qualified", () => {
  assert.deepEqual(qualifyImageTags("vinrosso/immich-vdf", ["0.1.0", "latest"]), [
    "vinrosso/immich-vdf:0.1.0",
    "vinrosso/immich-vdf:latest",
  ]);
});

test("the publish command prints one comma-separated line", () => {
  const manual = spawnSync(process.execPath, [script, "vinrosso/immich-vdf"], {
    input: "v0.1.0\nv0.2.0\n",
    encoding: "utf8",
  });
  assert.equal(manual.status, 0);
  assert.equal(
    manual.stdout,
    "vinrosso/immich-vdf:0.2.0,vinrosso/immich-vdf:0.2,vinrosso/immich-vdf:0,vinrosso/immich-vdf:latest",
  );

  const automatic = spawnSync(process.execPath, [script, "vinrosso/immich-vdf"], {
    input: "v9.9.9\n",
    encoding: "utf8",
    env: { ...process.env, RELEASE_TAG: "v0.1.0" },
  });
  assert.equal(automatic.status, 0);
  assert.equal(
    automatic.stdout,
    "vinrosso/immich-vdf:0.1.0,vinrosso/immich-vdf:0.1,vinrosso/immich-vdf:0,vinrosso/immich-vdf:latest",
  );

  const invalid = spawnSync(process.execPath, [script, "vinrosso/immich-vdf"], {
    input: "",
    encoding: "utf8",
    env: { ...process.env, RELEASE_TAG: "v0.1" },
  });
  assert.equal(invalid.status, 1);
});
