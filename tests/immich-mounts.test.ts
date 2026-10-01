import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapImmichImportPathToHost } from "../src/lib/immich-mounts";
import type { AppConfig } from "../src/lib/config";

const baseConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  dataDir: "/data",
  mediaRoots: [],
  immichLibrary: "\\\\god\\storage\\immich\\library",
  immichScanRoots: ["\\\\god\\storage\\immich\\library", "/home/user/photos1"],
  port: 4747,
  host: "0.0.0.0",
  password: "",
  production: false,
  vdfCli: "vdf-cli",
  trustedProxy: "",
  cpuCount: 4,
  ...overrides,
});

describe("mapImmichImportPathToHost", () => {
  it("maps Immich /data/library paths onto a library-folder mount", () => {
    const mount = "\\\\god\\storage\\immich\\library";
    const children = ["admin"];
    assert.equal(mapImmichImportPathToHost("/data/library", mount, children, baseConfig()), mount);
    assert.equal(
      mapImmichImportPathToHost("/data/library/admin", mount, children, baseConfig()),
      "\\\\god\\storage\\immich\\library\\admin",
    );
  });

  it("maps Immich /data paths onto a full upload mount", () => {
    const mount = "/immich";
    const children = ["library", "upload", "thumbs"];
    assert.equal(mapImmichImportPathToHost("/data/library/admin", mount, children, baseConfig({ immichLibrary: mount })), "/immich/library/admin");
  });

  it("passes through external roots configured on the host", () => {
    const config = baseConfig();
    assert.equal(mapImmichImportPathToHost("/home/user/photos1", config.immichLibrary, ["admin"], config), "/home/user/photos1");
  });

  it("ignores unknown container import paths", () => {
    assert.equal(mapImmichImportPathToHost("/mnt/other", "\\\\god\\storage\\immich\\library", ["admin"], baseConfig()), null);
  });
});
