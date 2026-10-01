import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { parse } from "node:url";
import { loadEnvConfig } from "@next/env";
import next from "next";
import { ensureRuntimeDirs, loadConfig } from "./src/lib/config";
import { errorText } from "./src/lib/errors";
import { passwordIsAcceptable } from "./src/lib/password";
import { redact } from "./src/lib/redact";
import { requestIsHttps, stripUntrustedForwarding } from "./src/lib/request-meta";
import { startScheduler } from "./src/lib/scheduler";
import { loginUrlForPath, safeLoginNext } from "./src/lib/auth-redirect";
import { cookieIsValid } from "./src/lib/session";
import { loadSettings, secretValues } from "./src/lib/store";
import { handleRaw } from "./src/server/raw";

loadEnvConfig(process.cwd());

const config = loadConfig();
if (!passwordIsAcceptable(config.password)) {
  console.error("APP_PASSWORD must be at least 8 characters. The placeholder change-me is refused.");
  process.exit(1);
}
ensureRuntimeDirs(config);
startScheduler();

const dev = nextDevMode();
const app = next({ dev, hostname: config.host, port: config.port });
const handle = app.getRequestHandler();

async function main(): Promise<void> {
await app.prepare();
const upgrade = app.getUpgradeHandler();

const onRequest = async (request: IncomingMessage, response: ServerResponse) => {
  try {
    stripUntrustedForwarding(request);
    applySecurityHeaders(request, response);
    const host = request.headers.host || `127.0.0.1:${config.port}`;
    const url = new URL(request.url || "/", `http://${host}`);
    if (await handleRaw(request, response, url)) return;
    const authed = await cookieIsValid(request.headers.cookie);
    if (!authed && !isPublicPage(url.pathname)) {
      if (url.pathname.startsWith("/api")) {
        response.writeHead(401, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ error: "Sign in required" }));
        return;
      }
      response.writeHead(302, { Location: loginUrlForPath(url.pathname, url.search) });
      response.end();
      return;
    }
    if (authed && url.pathname === "/login") {
      const dest = safeLoginNext(url.searchParams.get("next")) ?? "/";
      response.writeHead(302, { Location: dest });
      response.end();
      return;
    }
    await handle(request, response, parse(request.url || "/", true));
  } catch (error) {
    const settings = await loadSettings().catch(() => null);
    console.error(redact(errorText(error), settings ? secretValues(settings) : []));
    if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
    response.end("internal error");
  }
};
const httpServer = createServer(onRequest);

httpServer.on("upgrade", (request, socket, head) => {
  stripUntrustedForwarding(request);
  void (async () => {
    if (!dev && !(await cookieIsValid(request.headers.cookie))) {
      socket.destroy();
      return;
    }
    await upgrade(request, socket, head);
  })().catch(() => socket.destroy());
});

httpServer.listen(config.port, config.host, () => {
  console.log(`immich-vdf listening on http://${config.host}:${config.port}`);
});
}

void main();

function applySecurityHeaders(request: IncomingMessage, response: ServerResponse): void {
  const script = dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'";
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      script,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  );
  if (requestIsHttps(request)) response.setHeader("Strict-Transport-Security", "max-age=15552000");
}

function isPublicPage(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/_next") || pathname === "/favicon.ico";
}

function nextDevMode(): boolean {
  const lifecycle = process.env.npm_lifecycle_event;
  if (lifecycle === "dev" || lifecycle === "dev:web") return true;
  const built = existsSync(path.join(process.cwd(), ".next", "required-server-files.json"));
  if (!built) {
    if (process.env.NODE_ENV === "production") {
      console.warn("No Next.js production build found; using development mode. Run `npm run build` before `npm start`.");
    }
    return true;
  }
  return process.env.NODE_ENV !== "production";
}
