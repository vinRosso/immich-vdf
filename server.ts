import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { ensureRuntimeDirs, loadConfig } from "./src/lib/config";
import { errorText } from "./src/lib/errors";
import { redact } from "./src/lib/redact";
import { startScheduler } from "./src/lib/scheduler";
import { cookieIsValid } from "./src/lib/session";
import { loadSettings, secretValues } from "./src/lib/store";
import { handleRaw } from "./src/server/raw";

const config = loadConfig();
if (!config.password) {
  console.error("APP_PASSWORD is required");
  process.exit(1);
}
ensureRuntimeDirs(config);
startScheduler();

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, hostname: config.host, port: config.port });
const handle = app.getRequestHandler();
const upgrade = app.getUpgradeHandler();

await app.prepare();

const httpServer = createServer(async (request, response) => {
  try {
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
      response.writeHead(302, { Location: "/login" });
      response.end();
      return;
    }
    if (authed && (url.pathname === "/login" || url.pathname === "/")) {
      response.writeHead(302, { Location: "/server" });
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
});

httpServer.on("upgrade", (request, socket, head) => {
  upgrade(request, socket, head).catch(() => socket.destroy());
});

httpServer.listen(config.port, config.host, () => {
  console.log(`VDF web listening on http://${config.host}:${config.port}`);
});

function isPublicPage(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/_next") || pathname === "/favicon.ico";
}
