import type { IncomingMessage } from "node:http";
import { ipInCidr, isTrustedProxyCidr } from "./cidr";
import { loadConfig } from "./config";

export function clientIp(request: IncomingMessage): string {
  const remote = request.socket.remoteAddress || "unknown";
  const cidr = loadConfig().trustedProxy;
  if (!isTrustedProxyCidr(cidr) || !ipInCidr(normalizeIp(remote), cidr)) return remote;
  const forwarded = request.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || remote;
}

export function requestIsHttps(request: IncomingMessage): boolean {
  const socket = request.socket as { encrypted?: boolean };
  if (socket.encrypted) return true;
  const cidr = loadConfig().trustedProxy;
  const remote = normalizeIp(request.socket.remoteAddress || "");
  if (!isTrustedProxyCidr(cidr) || !ipInCidr(remote, cidr)) return false;
  const header = request.headers["x-forwarded-proto"];
  const value = (Array.isArray(header) ? header[0] : header)?.split(",")[0]?.trim();
  return value === "https";
}

function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/, "");
}

/** Browser `Origin` or `Referer` must match the request host. Missing both is allowed for non-browser clients. */
export function mutationSiteAllowed(input: {
  origin?: string | null;
  referer?: string | null;
  host?: string | null;
}): boolean {
  if (input.origin) return originMatchesHost(input.origin, input.host);
  if (!input.referer) return true;
  try {
    return originMatchesHost(new URL(input.referer).origin, input.host);
  } catch {
    return false;
  }
}

/** Browser `Origin` must match the request host. Missing Origin is allowed (non-browser clients). */
export function originMatchesHost(origin: string | null | undefined, host: string | null | undefined): boolean {
  if (!origin) return true;
  const expected = host?.split(",")[0]?.trim();
  if (!expected) return false;
  try {
    return new URL(origin).host.toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}
