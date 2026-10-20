import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { listArchivedImmichAssetIds, listTrashedImmichAssets } from "../src/lib/immich";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

type Page = { items: Record<string, unknown>[]; nextPage: string | null };

/** Stands in for Immich: pages per asset type, and remembers how many searches ran at the same time. */
function fakeImmich(pages: Record<string, Page[]>) {
  const state = { active: 0, peak: 0, requests: [] as string[] };
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { type: string; page: number };
    state.requests.push(`${body.type}:${body.page}`);
    state.active += 1;
    state.peak = Math.max(state.peak, state.active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    state.active -= 1;
    const page = pages[body.type]?.[body.page - 1] ?? { items: [], nextPage: null };
    return new Response(JSON.stringify({ assets: page }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return state;
}

// A documentation address: it is neither loopback nor private, so the fetch guard lets it through.
const BASE = "http://203.0.113.7:2283";

const windowsPath = ["C:", "data", "b.jpg"].join(String.fromCharCode(92));

test("trashed assets from images and videos are listed together", async () => {
  const state = fakeImmich({
    IMAGE: [
      { items: [{ id: "i1", originalPath: "/data/a.jpg", isTrashed: true }], nextPage: "2" },
      { items: [{ id: "i2", originalPath: windowsPath, isTrashed: true }], nextPage: null },
    ],
    VIDEO: [{ items: [{ id: "v1", originalPath: "/data/c.mp4", isTrashed: true }], nextPage: null }],
  });
  const trashed = await listTrashedImmichAssets(BASE, "key");
  assert.deepEqual([...trashed.ids].sort(), ["i1", "i2", "v1"]);
  assert.deepEqual([...trashed.originalPaths].sort(), ["/data/a.jpg", "/data/c.mp4", "C:/data/b.jpg"]);
  assert.ok(state.peak >= 2, "image and video searches should overlap");
  assert.deepEqual(state.requests.slice().sort(), ["IMAGE:1", "IMAGE:2", "VIDEO:1"]);
});

test("archived assets from images and videos are listed together", async () => {
  const state = fakeImmich({
    IMAGE: [{ items: [{ id: "i1", originalPath: "/data/a.jpg", isArchived: true }], nextPage: null }],
    VIDEO: [{ items: [{ id: "v1", originalPath: "/data/c.mp4", isArchived: true }], nextPage: null }],
  });
  const archived = await listArchivedImmichAssetIds(BASE, "key");
  assert.deepEqual([...archived].sort(), ["i1", "v1"]);
  assert.ok(state.peak >= 2);
});

test("a failing search rejects the whole listing", async () => {
  globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  await assert.rejects(listTrashedImmichAssets(BASE, "key"), /Immich trash search failed \(500\)/);
});
