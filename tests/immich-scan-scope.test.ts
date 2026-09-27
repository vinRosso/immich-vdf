import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planImmichScanPaths } from "../src/lib/immich-scan-scope";

describe("planImmichScanPaths", () => {
  it("scans library/<storageLabel> and skips other users and generated folders", () => {
    const plan = planImmichScanPaths({
      uploadMount: "/immich",
      scanRoots: ["/immich", "/home/user/photos1"],
      configuredIncludes: ["/immich", "/home/user/photos1"],
      uploadChildren: ["library", "upload", "thumbs", "encoded-video", "profile"],
      libraryChildren: ["admin", "kevin"],
      legacyUploadChildren: ["11111111-1111-1111-1111-111111111111"],
      storageLabel: "admin",
      userId: "11111111-1111-1111-1111-111111111111",
    });
    assert.deepEqual(plan.includes, ["/immich/library/admin", "/home/user/photos1"]);
    assert.deepEqual(plan.excludes, ["/immich/thumbs", "/immich/encoded-video", "/immich/profile"]);
  });

  it("uses the legacy upload/<userId> folder only when library has no user folder", () => {
    const plan = planImmichScanPaths({
      uploadMount: "/immich",
      scanRoots: ["/immich"],
      configuredIncludes: [],
      uploadChildren: ["upload"],
      libraryChildren: [],
      legacyUploadChildren: ["user-id"],
      storageLabel: null,
      userId: "user-id",
    });
    assert.deepEqual(plan.includes, ["/immich/upload/user-id"]);
  });

  it("scans the storage-label folder when the mount is already the library directory", () => {
    const plan = planImmichScanPaths({
      uploadMount: "\\\\god\\storage\\immich\\library",
      scanRoots: ["\\\\god\\storage\\immich\\library"],
      configuredIncludes: ["\\\\god\\storage\\immich\\library"],
      uploadChildren: ["admin"],
      libraryChildren: [],
      storageLabel: "admin",
      userId: "11111111-1111-1111-1111-111111111111",
    });
    assert.deepEqual(plan.includes, ["\\\\god\\storage\\immich\\library\\admin"]);
  });

  it("keeps a specific include folder", () => {
    const plan = planImmichScanPaths({
      uploadMount: "/immich",
      scanRoots: ["/immich"],
      configuredIncludes: ["/immich/library/admin/2024"],
      uploadChildren: ["library", "thumbs"],
      libraryChildren: ["admin"],
      storageLabel: "admin",
    });
    assert.deepEqual(plan.includes, ["/immich/library/admin/2024"]);
  });
});
