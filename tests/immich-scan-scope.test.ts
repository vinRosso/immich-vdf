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

describe("immichScanFolderPlan and the Immich user", () => {
  const BASE = "http://203.0.113.7:2283";
  const realFetch = globalThis.fetch;

  async function withLibrary(fetcher: typeof fetch, run: () => Promise<void>) {
    const { mkdtemp, mkdir } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(os.tmpdir(), "vdf-scope-"));
    await mkdir(path.join(dir, "library", "admin"), { recursive: true });
    const before = process.env.IMMICH_LIBRARY;
    process.env.IMMICH_LIBRARY = dir;
    globalThis.fetch = fetcher;
    try {
      await run();
    } finally {
      globalThis.fetch = realFetch;
      if (before === undefined) delete process.env.IMMICH_LIBRARY;
      else process.env.IMMICH_LIBRARY = before;
    }
  }

  const settings = { includes: [], excludes: [] } as unknown as import("../src/lib/types").ScanSettings;

  it("stops when the key cannot read the user instead of scanning every user", async () => {
    const fetcher = (async (input: unknown) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/api/users/me") {
        return Response.json({ message: "Missing required permission: user.read" }, { status: 403 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    await withLibrary(fetcher, async () => {
      const { immichScanFolderPlan } = await import("../src/lib/immich-scan-scope");
      await assert.rejects(immichScanFolderPlan(settings, { baseUrl: BASE, apiKey: "scope-a" }), /missing: user\.read/);
    });
  });

  it("still plans the scan when Immich is unreachable", async () => {
    const fetcher = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await withLibrary(fetcher, async () => {
      const { immichScanFolderPlan } = await import("../src/lib/immich-scan-scope");
      const plan = await immichScanFolderPlan(settings, { baseUrl: BASE, apiKey: "scope-b" });
      assert.ok(plan.includeSources.length > 0);
    });
  });
});
