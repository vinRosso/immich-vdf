import { once } from "node:events";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AppError, errorText } from "../lib/errors";
import { openImmichThumbnail } from "../lib/immich";
import { loadConfig } from "../lib/config";
import { PathJailError } from "../lib/path-jail";
import { clientIp, mutationSiteAllowed, requestIsHttps } from "../lib/request-meta";
import { clearLoginFailures, loginAllowed, recordLoginFailure } from "../lib/rate-limit";
import { redact } from "../lib/redact";
import { getScan } from "../lib/scan";
import {
  clearCookie,
  cookieIsValid,
  issueToken,
  passwordsMatch,
  readCookie,
  revokeToken,
  sessionCookie,
  sessionExpiry,
  sessionSecret,
} from "../lib/session";
import { loadSettings, resultsMembership, secretValues } from "../lib/store";
import { ThumbnailCancelled } from "../lib/thumbs";
import { HttpUrlError } from "../lib/urls";
import { trashThumbFile } from "../lib/trash";
import { sectionParam, streamMedia, thumbnailFile } from "./media";

export async function handleRaw(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
  const { pathname } = url;
  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/login") {
    if (!originAllowed(request)) {
      sendJson(response, 403, { error: "Cross-origin request refused" });
      return true;
    }
    await login(request, response);
    return true;
  }
  if (request.method === "POST" && pathname === "/api/logout") {
    if (!originAllowed(request)) {
      sendJson(response, 403, { error: "Cross-origin request refused" });
      return true;
    }
    const token = readCookie(request.headers.cookie);
    if (token) await revokeToken(token);
    response.setHeader("Set-Cookie", clearCookie(requestIsHttps(request)));
    sendJson(response, 200, { ok: true });
    return true;
  }
  if (!isProtected(pathname)) return false;
  if (!(await cookieIsValid(request.headers.cookie))) {
    sendJson(response, 401, { error: "Sign in required" });
    return true;
  }
  try {
    if (request.method === "GET" && pathname === "/api/scan/events") {
      await events(request, response);
      return true;
    }
    if (request.method === "GET" && pathname === "/api/media") {
      const section = sectionParam(url.searchParams.get("section"));
      const filePath = requiredQuery(url, "path");
      const start = url.searchParams.get("t");
      await streamMedia(
        request,
        response,
        section,
        filePath,
        start === null ? null : Number(start),
        url.searchParams.get("mode"),
        url.searchParams.get("play"),
        Number(url.searchParams.get("h")),
      );
      return true;
    }
    if (request.method === "GET" && pathname === "/api/thumbs") {
      if (url.searchParams.get("trash") === "1") {
        const thumb = await trashThumbFile(requiredQuery(url, "mount"), requiredQuery(url, "relative"));
        await sendStatic(request, response, thumb.file, thumb.contentType);
      } else {
        const file = await thumbnailFile(
          sectionParam(url.searchParams.get("section")),
          requiredQuery(url, "path"),
          url.searchParams.get("kind") || "poster",
          Number(url.searchParams.get("index") || 0),
          {
            priority: url.searchParams.get("priority") === "viewer" ? "viewer" : "thumbnail",
            signal: clientAbortSignal(request, response),
          },
        );
        await sendStatic(request, response, file);
      }
      return true;
    }
    if (request.method === "GET" && pathname === "/api/immich-thumb") {
      await proxyImmichThumb(request, response, requiredQuery(url, "id"));
      return true;
    }
  } catch (error) {
    if (response.headersSent || error instanceof ThumbnailCancelled) {
      if (!response.writableEnded) response.end();
      return true;
    }
    const known = error instanceof AppError || error instanceof PathJailError || error instanceof HttpUrlError;
    const settings = await loadSettings().catch(() => null);
    const message = known && error instanceof Error ? error.message : "Something went wrong";
    if (!known) console.error(redact(errorText(error), settings ? secretValues(settings) : []));
    sendJson(response, error instanceof AppError ? error.status : known ? 400 : 500, {
      error: redact(message, settings ? secretValues(settings) : []),
    });
    return true;
  }
  return false;
}

function isProtected(pathname: string): boolean {
  return (
    pathname === "/api/scan/events" ||
    pathname === "/api/media" ||
    pathname === "/api/thumbs" ||
    pathname === "/api/immich-thumb"
  );
}

async function login(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const ip = clientIp(request);
  const limit = loginAllowed(ip);
  if (!limit.ok) {
    response.setHeader("Retry-After", String(limit.retryAfter));
    sendJson(response, 429, { error: "Too many sign-in attempts" });
    return;
  }
  let password = "";
  try {
    const body = (await readJson(request)) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    sendJson(response, 400, { error: "Sign-in request was not valid JSON" });
    return;
  }
  const expected = loadConfig().password;
  if (!expected || !passwordsMatch(password, expected)) {
    recordLoginFailure(ip);
    sendJson(response, 401, { error: "Wrong password" });
    return;
  }
  clearLoginFailures(ip);
  const token = issueToken(await sessionSecret(), sessionExpiry());
  response.setHeader("Set-Cookie", sessionCookie(token, requestIsHttps(request)));
  sendJson(response, 200, { ok: true });
}

function events(request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  const send = (event: string, data: unknown) => {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const unsubscribe = getScan().subscribe((event) => {
    if (event.event === "snapshot") send("snapshot", event);
    else if (event.event === "log") send("log", { line: event.line });
    else send("done", event);
  });
  const timer = setInterval(() => response.write(": ping\n\n"), 15_000);
  request.on("close", () => {
    clearInterval(timer);
    unsubscribe();
  });
}

function clientAbortSignal(request: IncomingMessage, response: ServerResponse): AbortSignal {
  const controller = new AbortController();
  const stop = () => {
    if (!response.writableFinished) controller.abort();
  };
  request.on("aborted", stop);
  response.on("close", stop);
  return controller.signal;
}

function originAllowed(request: IncomingMessage): boolean {
  const forwarded = request.headers["x-forwarded-host"];
  const host = (Array.isArray(forwarded) ? forwarded[0] : forwarded) || request.headers.host;
  return mutationSiteAllowed({
    origin: request.headers.origin,
    referer: request.headers.referer,
    host: Array.isArray(host) ? host[0] : host,
  });
}

async function proxyImmichThumb(request: IncomingMessage, response: ServerResponse, assetId: string): Promise<void> {
  const membership = await resultsMembership("immich");
  if (!membership.found || !membership.assetIds.has(assetId)) throw new AppError("That asset is not in the current results", 404);
  const settings = await loadSettings();
  if (!settings.immich.baseUrl || !settings.immich.apiKey) throw new AppError("Immich is not configured");
  const upstream = await openImmichThumbnail(settings.immich.baseUrl, settings.immich.apiKey, assetId);
  if (upstream.status >= 300 || !upstream.body) {
    throw new AppError(`Immich thumbnail failed (${upstream.status})`, 502);
  }
  response.writeHead(200, {
    "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  const reader = upstream.body.getReader();
  const stop = () => {
    void reader.cancel().catch(() => undefined);
  };
  request.on("close", stop);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!response.write(Buffer.from(value))) await once(response, "drain");
    }
  } finally {
    response.end();
  }
}

async function sendStatic(
  request: IncomingMessage,
  response: ServerResponse,
  file: string,
  contentType = "image/jpeg",
): Promise<void> {
  const info = await stat(file);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": info.size,
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  });
  const stream = createReadStream(file);
  stream.pipe(response);
  request.on("close", () => stream.destroy());
}

function requiredQuery(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (!value) throw new AppError(`Missing ${key}`);
  return value;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("body too large");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(payload);
}
