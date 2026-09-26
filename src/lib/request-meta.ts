import type { IncomingMessage } from "node:http";
import { ipInCidr } from "./cidr";
import { loadConfig } from "./config";

export function clientIp(request: IncomingMessage): string {
  const remote = request.socket.remoteAddress || "unknown";
  const cidr = loadConfig().trustedProxy;
  if (!cidr || !ipInCidr(normalizeIp(remote), cidr)) return remote;
  const forwarded = request.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || remote;
}

export function requestIsHttps(request: IncomingMessage): boolean {
  const socket = request.socket as { encrypted?: boolean };
  if (socket.encrypted) return true;
  const cidr = loadConfig().trustedProxy;
  const remote = normalizeIp(request.socket.remoteAddress || "");
  if (!cidr || !ipInCidr(remote, cidr)) return false;
  const header = request.headers["x-forwarded-proto"];
  const value = (Array.isArray(header) ? header[0] : header)?.split(",")[0]?.trim();
  return value === "https";
}

function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/, "");
}
