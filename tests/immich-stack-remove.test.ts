import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { removeAssetsFromStack } from "../src/lib/immich";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// A documentation address: it is neither loopback nor private, so the fetch guard lets it through.
const BASE = "http://203.0.113.7:2283";
const STACK = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(status: (url: string, method: string) => number) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body });
    const code = status(url, method);
    if (method === "GET" && code === 200) {
      return Response.json({ id: STACK, primaryAssetId: A, assets: [{ id: A, originalPath: "/a.jpg" }, { id: B, originalPath: "/b.jpg" }] });
    }
    return new Response(null, { status: code });
  }) as typeof fetch;
  return calls;
}

test("removeAssetsFromStack sends one DELETE per asset on Immich's per-asset route", async () => {
  const calls = record(() => 204);
  await removeAssetsFromStack(BASE, "key", STACK, [A, B]);
  assert.deepEqual(
    calls.map((c) => [c.method, c.url, c.body]),
    [
      ["DELETE", `${BASE}/api/stacks/${STACK}/assets/${A}`, undefined],
      ["DELETE", `${BASE}/api/stacks/${STACK}/assets/${B}`, undefined],
    ],
  );
});

test("removeAssetsFromStack stops quietly once Immich has deleted the stack", async () => {
  // Immich deletes a stack when fewer than two assets remain; the next removal and the stack lookup answer 400.
  const calls = record((url, method) => (method === "DELETE" && url.endsWith(A) ? 204 : 400));
  await removeAssetsFromStack(BASE, "key", STACK, [A, B, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"]);
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      ["DELETE", `${BASE}/api/stacks/${STACK}/assets/${A}`],
      ["DELETE", `${BASE}/api/stacks/${STACK}/assets/${B}`],
      ["GET", `${BASE}/api/stacks/${STACK}`],
    ],
  );
});

test("removeAssetsFromStack throws on a 400 while the stack still exists", async () => {
  record((_url, method) => (method === "GET" ? 200 : 400));
  await assert.rejects(removeAssetsFromStack(BASE, "key", STACK, [B]), /stack remove failed \(400\)/);
});

test("removeAssetsFromStack explains that Immich will not remove the stack cover", async () => {
  record((_url, method) => (method === "GET" ? 200 : 400));
  await assert.rejects(removeAssetsFromStack(BASE, "key", STACK, [A]), /stack cover can't be removed/);
});

test("removeAssetsFromStack throws on other errors", async () => {
  record(() => 403);
  await assert.rejects(removeAssetsFromStack(BASE, "key", STACK, [A]), /stack remove failed \(403\)/);
});

test("removeAssetsFromStack skips an asset Immich says is no longer in the stack", async () => {
  // GET answers a stack holding only A and B; C was already taken out in Immich ("Asset not in stack").
  const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const calls = record((url, method) => (method === "GET" ? 200 : url.endsWith(C) ? 400 : 204));
  await removeAssetsFromStack(BASE, "key", STACK, [C, B]);
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      ["DELETE", `${BASE}/api/stacks/${STACK}/assets/${C}`],
      ["GET", `${BASE}/api/stacks/${STACK}`],
      ["DELETE", `${BASE}/api/stacks/${STACK}/assets/${B}`],
    ],
  );
});

test("removeFromImmichStack refuses the stack cover before asking Immich", async () => {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(os.tmpdir(), "vdf-unstack-"));
  await writeFile(path.join(dir, "settings.json"), JSON.stringify({ immich: { baseUrl: BASE, apiKey: "key" } }));
  const member = (id: string, primary: boolean) => ({
    path: `/lib/${id}.jpg`, similarity: 99, sizeBytes: 10, durationSeconds: 0, resolution: null, width: 1, height: 1,
    bitrateKbps: 0, bitDepth: 8, audioBitrateKbps: 0, dateCreatedMs: 0, flags: [], partialClipOffsetSeconds: 0,
    isImage: true, format: null, fps: 0, assetId: id, originalPath: null, stackId: STACK, stackPrimary: primary,
  });
  await mkdir(path.join(dir, "results"), { recursive: true });
  await writeFile(
    path.join(dir, "results", "immich.json"),
    JSON.stringify({ finishedAt: "2026-01-01T00:00:00Z", error: null, warning: null, groups: [{ groupId: "g1", items: [member(A, true), member(B, false)] }] }),
  );
  process.env.DATA_DIR = dir;
  const calls = record(() => 204);
  const { removeFromImmichStack } = await import("../src/lib/actions");
  await assert.rejects(removeFromImmichStack("g1", [B, A]), /cover/);
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 0);
});
