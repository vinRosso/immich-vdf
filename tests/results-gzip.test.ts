import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";

// Next.js drops Content-Encoding from route handler responses and gzips the body again, so the browser got
// gzip bytes where it expected JSON. The custom server sends the cached gzip view itself.

async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vdf-results-gzip-"));
  process.env.DATA_DIR = dir;
  process.env.APP_PASSWORD = "results-gzip-test";
  await mkdir(path.join(dir, "results"), { recursive: true });
  await writeFile(
    path.join(dir, "results", "server.json"),
    JSON.stringify({ finishedAt: "2026-01-01T00:00:00Z", error: null, warning: null, groups: [] }),
  );
  const { handleRaw } = await import("../src/server/raw");
  const session = await import("../src/lib/session");
  const token = session.issueToken(await session.sessionSecret(), session.sessionExpiry(), await session.sessionEpoch());
  const cookie = session.sessionCookie(token, false).split(";")[0];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://local");
    if (!(await handleRaw(request, response, url))) {
      response.writeHead(599);
      response.end("not handled by raw");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, port, cookie };
}

function get(port: number, pathname: string, headers: http.OutgoingHttpHeaders) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: pathname, headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
      })
      .on("error", reject);
  });
}

test("the results view is sent gzip-compressed once, with its length, by the custom server", async () => {
  const { server, port, cookie } = await setup();
  try {
    const response = await get(port, "/api/results?section=server", { cookie, "accept-encoding": "gzip, br" });
    assert.equal(response.status, 200);
    assert.equal(response.headers["content-encoding"], "gzip");
    assert.equal(Number(response.headers["content-length"]), response.body.length);
    const view = JSON.parse(gunzipSync(response.body).toString("utf8"));
    assert.equal(view.section, "server");

    const signedOut = await get(port, "/api/results?section=server", { "accept-encoding": "gzip" });
    assert.equal(signedOut.status, 401);

    const badSection = await get(port, "/api/results?section=nope", { cookie, "accept-encoding": "gzip" });
    assert.equal(badSection.status, 400);
  } finally {
    server.close();
  }
});

test("the preview and uncompressed requests are left to Next.js", async () => {
  const { server, port, cookie } = await setup();
  try {
    assert.equal((await get(port, "/api/results?section=server&preview=1", { cookie, "accept-encoding": "gzip" })).status, 599);
    assert.equal((await get(port, "/api/results?section=server", { cookie })).status, 599);
  } finally {
    server.close();
  }
});
