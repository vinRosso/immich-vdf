import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeArchiveEntries, compareRelease, newestStableVersion, releaseAssetName, releaseDownloadUrl } from "../src/lib/cli-release";

test("newest stable release ignores rolling tags", () => {
  assert.equal(
    newestStableVersion([{ tag_name: "4.1.x" }, { tag_name: "v4.1.1" }, { tag_name: "v4.0.9" }, { tag_name: "v4.1.0" }]),
    "4.1.1",
  );
  assert.equal(newestStableVersion([{ tag_name: "master" }]), null);
});

test("release comparison", () => {
  assert.equal(compareRelease("4.1.1", "4.1.1"), "current");
  assert.equal(compareRelease("4.1.1+21ec967", "4.1.2"), "update");
  assert.equal(compareRelease("4.2.0", "4.1.9"), "current");
  assert.equal(compareRelease(null, "4.1.1"), "unknown");
});

test("official download URL is pinned to the release asset", () => {
  const url = releaseDownloadUrl("4.1.1", "CLI-win-x64.zip", [
    { name: "CLI-win-x64.zip", browser_download_url: "https://github.com/0x90d/videoduplicatefinder/releases/download/v4.1.1/CLI-win-x64.zip" },
  ]);
  assert.equal(url, "https://github.com/0x90d/videoduplicatefinder/releases/download/v4.1.1/CLI-win-x64.zip");
  assert.throws(
    () => releaseDownloadUrl("4.1.1", "CLI-win-x64.zip", [{ name: "CLI-win-x64.zip", browser_download_url: "https://example.test/cli.zip" }]),
    /official/,
  );
  assert.equal(releaseAssetName("linux", "x64"), "CLI-linux-x64.tar.gz");
  assert.equal(releaseAssetName("win32", "x64"), "CLI-win-x64.zip");
});

test("archive entries cannot escape the extract directory", () => {
  assert.doesNotThrow(() => assertSafeArchiveEntries(["outputCLI/vdf-cli"]));
  assert.throws(() => assertSafeArchiveEntries(["../vdf-cli"]), /unsafe/);
  assert.throws(() => assertSafeArchiveEntries(["/tmp/vdf-cli"]), /unsafe/);
});
