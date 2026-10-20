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

test("parseVolumeBinds reads host:mount in Compose order, also for POSIX and drive-letter hosts", () => {
  assert.deepEqual(parseVolumeBinds("/my/local/path:/data/library/admin"), [
    { mount: "/data/library/admin", host: "/my/local/path" },
  ]);
  assert.deepEqual(parseVolumeBinds("C:\\photos:/mnt/photos:ro"), [{ mount: "/mnt/photos", host: "C:\\photos" }]);
  assert.deepEqual(parseVolumeBinds("C:/photos:/mnt/photos"), [{ mount: "/mnt/photos", host: "C:/photos" }]);
  // The older mount:host order still works when the host is not a POSIX path.
  assert.deepEqual(parseVolumeBinds("/mnt/photos:\\\\god\\memories"), [{ mount: "/mnt/photos", host: "\\\\god\\memories" }]);
  // Entries split on commas and semicolons, longest mount first.
  assert.deepEqual(parseVolumeBinds("/my/local/path:/data/library/admin,/other:/mnt/photos;/third=/x"), [
    { mount: "/data/library/admin", host: "/my/local/path" },
    { mount: "/mnt/photos", host: "/other" },
    { mount: "/third", host: "/x" },
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
