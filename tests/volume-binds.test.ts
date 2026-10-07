import assert from "node:assert/strict";
import test from "node:test";
import { mapImmichImportPathToHost } from "../src/lib/immich-mounts";
import { hostPathForContainerMount, parseVolumeBinds } from "../src/lib/volume-binds";
import type { AppConfig } from "../src/lib/config";

test("parseVolumeBinds accepts mount=host and host:mount", () => {
  assert.deepEqual(parseVolumeBinds("/immich/library/admin=\\\\god\\memories"), [
    { mount: "/immich/library/admin", host: "\\\\god\\memories" },
  ]);
  assert.deepEqual(parseVolumeBinds("\\\\god\\memories:/mnt/photos:ro"), [
    { mount: "/mnt/photos", host: "\\\\god\\memories" },
  ]);
});

test("mapImmichImportPathToHost applies VOLUME_BINDS over upload mapping", () => {
  const config: AppConfig = {
    dataDir: "/data",
    mediaRoots: [],
    immichLibrary: "\\\\god\\storage\\immich",
    immichScanRoots: ["\\\\god\\storage\\immich"],
    volumeBinds: parseVolumeBinds("/data/library/admin=\\\\god\\storage\\kevin\\2_memories"),
    port: 4747,
    host: "0.0.0.0",
    password: "",
    production: false,
    vdfCli: "vdf-cli",
    trustedProxy: "",
    cpuCount: 4,
  };
  const children = ["library", "upload", "thumbs"];
  assert.equal(
    mapImmichImportPathToHost("/data/library/admin/2016/photo.jpg", "\\\\god\\storage\\immich", children, config),
    "\\\\god\\storage\\kevin\\2_memories\\2016\\photo.jpg",
  );
  assert.equal(hostPathForContainerMount("/mnt/external", config), null);
});
