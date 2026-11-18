import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { AppError } from "../src/lib/errors";
import { fetchImmichKeyPermissions, immichFetch } from "../src/lib/immich";
import {
  keyHas,
  missingNeeded,
  missingPermissionMessage,
  NEEDED_IMMICH_PERMISSIONS,
  type KeyPermissions,
} from "../src/lib/immich-permissions";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// A documentation address: it is neither loopback nor private, so the fetch guard lets it through.
const BASE = "http://203.0.113.7:2283";

const perms = (list: string[], known = true): KeyPermissions => ({ known, granted: new Set(list) });

function answer(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

test("keyHas grants everything for all, a listed permission, or unknown permissions", () => {
  assert.equal(keyHas(perms(["all"]), "asset.delete"), true);
  assert.equal(keyHas(perms(["album.read"]), "album.read"), true);
  assert.equal(keyHas(perms(["album.read"]), "asset.delete"), false);
  assert.equal(keyHas(perms([], false), "asset.delete"), true);
});

test("missingNeeded lists absent needed permissions in order", () => {
  assert.deepEqual(missingNeeded(perms(["asset.read", "user.read"])), [
    "asset.view",
    "asset.delete",
    "stack.read",
    "stack.create",
    "stack.update",
  ]);
  assert.deepEqual(missingNeeded(perms(["all"])), []);
  assert.deepEqual(missingNeeded(perms([], false)), []);
  assert.equal(NEEDED_IMMICH_PERMISSIONS.length, 7);
});

test("missingPermissionMessage names the permissions and where to add them", () => {
  assert.equal(
    missingPermissionMessage(["asset.delete"]),
    "The Immich API key is missing: asset.delete. Add it in Immich under Account Settings → API Keys.",
  );
  assert.equal(
    missingPermissionMessage(["asset.delete", "stack.read"]),
    "The Immich API key is missing: asset.delete, stack.read. Add them in Immich under Account Settings → API Keys.",
  );
});

test("fetchImmichKeyPermissions reads the key's own permissions", async () => {
  answer(200, { id: "k", name: "vdf", permissions: ["album.read", "user.read"] });
  const result = await fetchImmichKeyPermissions(BASE, "key");
  assert.equal(result.known, true);
  assert.deepEqual([...result.granted].sort(), ["album.read", "user.read"]);
});

test("fetchImmichKeyPermissions treats an Immich without the endpoint as unknown", async () => {
  answer(404, { message: "Cannot GET /api/api-keys/me" });
  const result = await fetchImmichKeyPermissions(BASE, "key");
  assert.equal(result.known, false);
});

test("fetchImmichKeyPermissions rejects a key Immich does not accept", async () => {
  answer(401, { message: "Invalid API key" });
  await assert.rejects(fetchImmichKeyPermissions(BASE, "key"), /rejected the API key/);
});

test("immichFetch turns a missing-permission 403 into a clear AppError", async () => {
  answer(403, { message: "Missing required permission: asset.delete", statusCode: 403 });
  await assert.rejects(immichFetch(`${BASE}/api/assets`, { method: "DELETE" }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 403);
    assert.match(error.message, /missing: asset\.delete\./);
    return true;
  });
});

test("immichFetch passes other 403 answers through", async () => {
  answer(403, { message: "Forbidden", statusCode: 403 });
  const response = await immichFetch(`${BASE}/api/libraries`);
  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as { message: string }).message, "Forbidden");
});

/** Stands in for Immich: answers by path, records every path asked for. */
function fakeServer(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const pathname = new URL(String(input)).pathname;
    asked.push(pathname);
    const route = routes[pathname];
    return route ? route() : new Response("{}", { status: 404 });
  }) as typeof fetch;
  return asked;
}

const user = () => Response.json({ id: "u1", email: "a@b.c", name: "A", storageLabel: "admin" });

async function actions() {
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "vdf-perms-"));
  return import("../src/lib/actions");
}

test("Connect refuses a key that lacks needed permissions and names them", async () => {
  const { testImmichConnection } = await actions();
  const asked = fakeServer({
    "/api/server/ping": () => Response.json({ res: "pong" }),
    "/api/api-keys/me": () => Response.json({ permissions: ["user.read", "asset.read"] }),
    "/api/users/me": user,
  });
  await assert.rejects(
    testImmichConnection(BASE, "key-a"),
    /missing: asset\.view, asset\.delete, stack\.read, stack\.create, stack\.update\. Add them/,
  );
  assert.equal(asked.includes("/api/users/me"), false);
});

test("Connect accepts a key with all permissions", async () => {
  const { testImmichConnection } = await actions();
  fakeServer({
    "/api/server/ping": () => Response.json({ res: "pong" }),
    "/api/api-keys/me": () => Response.json({ permissions: ["all"] }),
    "/api/users/me": user,
  });
  const info = await testImmichConnection(BASE, "key-b");
  assert.equal(info.user.id, "u1");
});

test("Connect works on an Immich that cannot report key permissions", async () => {
  const { testImmichConnection } = await actions();
  fakeServer({
    "/api/server/ping": () => Response.json({ res: "pong" }),
    "/api/users/me": user,
  });
  const info = await testImmichConnection(BASE, "key-c");
  assert.equal(info.user.id, "u1");
});

async function actionsWithKey(apiKey: string) {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(os.tmpdir(), "vdf-perms-"));
  await writeFile(path.join(dir, "settings.json"), JSON.stringify({ immich: { baseUrl: BASE, apiKey } }));
  process.env.DATA_DIR = dir;
  return import("../src/lib/actions");
}

test("albums are switched off without album.read and Immich is not asked", async () => {
  const { albumsForAssets } = await actionsWithKey("album-a");
  const asked = fakeServer({ "/api/api-keys/me": () => Response.json({ permissions: ["asset.read"] }) });
  const result = await albumsForAssets(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
  assert.deepEqual(result, { albumsByAsset: {}, access: { read: false, add: false, remove: false } });
  assert.equal(asked.includes("/api/albums"), false);
});

test("albums report what the key may change", async () => {
  const { albumsForAssets } = await actionsWithKey("album-b");
  fakeServer({
    "/api/api-keys/me": () => Response.json({ permissions: ["album.read", "albumAsset.delete"] }),
    "/api/albums": () => Response.json([{ id: "al1", albumName: "Trip" }]),
  });
  const result = await albumsForAssets(["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
  assert.deepEqual(result.access, { read: true, add: false, remove: true });
  assert.deepEqual(result.albumsByAsset["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"], [{ id: "al1", name: "Trip" }]);
});

test("adding to an album without albumAsset.create gives the clear message and asks Immich nothing", async () => {
  const { mutateImmichAlbumAsset } = await actionsWithKey("album-c");
  const asked = fakeServer({ "/api/api-keys/me": () => Response.json({ permissions: ["album.read"] }) });
  await assert.rejects(
    mutateImmichAlbumAsset("11111111-1111-4111-8111-111111111111", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "add"),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 403);
      assert.match(error.message, /missing: albumAsset\.create\./);
      return true;
    },
  );
  assert.deepEqual(asked, ["/api/api-keys/me"]);
});

test("the original file is refused without asset.download and Immich is not asked for it", async () => {
  const { openImmichOriginalIfAllowed } = await import("../src/lib/immich");
  const asked = fakeServer({ "/api/api-keys/me": () => Response.json({ permissions: ["asset.read"] }) });
  await assert.rejects(openImmichOriginalIfAllowed(BASE, "orig-a", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 403);
    assert.match(error.message, /missing: asset\.download\./);
    return true;
  });
  assert.deepEqual(asked, ["/api/api-keys/me"]);
});

test("Connect works when an older Immich answers /api-keys/me with a permission it routes elsewhere", async () => {
  const { testImmichConnection } = await actions();
  fakeServer({
    "/api/server/ping": () => Response.json({ res: "pong" }),
    "/api/api-keys/me": () => Response.json({ message: "Missing required permission: apiKey.read" }, { status: 403 }),
    "/api/users/me": user,
  });
  const info = await testImmichConnection(BASE, "key-d");
  assert.equal(info.user.id, "u1");
});

test("the permission cache is shared by the same server written with or without /api", async () => {
  const { immichKeyPermissions } = await import("../src/lib/immich");
  const asked = fakeServer({ "/api/api-keys/me": () => Response.json({ permissions: ["all"] }) });
  await immichKeyPermissions(`${BASE}/api/`, "cache-a");
  await immichKeyPermissions(BASE, "cache-a");
  assert.equal(asked.length, 1);
});

test("an empty album request answers only what the key may do, without asking Immich for albums", async () => {
  const { albumsForAssets } = await actionsWithKey("album-d");
  const asked = fakeServer({ "/api/api-keys/me": () => Response.json({ permissions: ["album.read", "albumAsset.create"] }) });
  const result = await albumsForAssets([]);
  assert.deepEqual(result, { albumsByAsset: {}, access: { read: true, add: true, remove: false } });
  assert.deepEqual(asked, ["/api/api-keys/me"]);
});
