import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class HttpUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpUrlError";
  }
}

const BLOCKED_NAMES = new Set(["localhost", "metadata.google.internal", "metadata.google.com"]);

export function assertHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpUrlError("URL must be http or https");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpUrlError("URL must be http or https");
  }
  if (url.username || url.password) {
    throw new HttpUrlError("URL must not include credentials");
  }
  return url;
}

/** Loopback, link-local (cloud metadata), and non-unicast addresses. Private LAN ranges stay allowed. */
export function ipIsBlockedTarget(ip: string): boolean {
  const normalized = ip.trim().toLowerCase().replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:")) return true;
  const parts = normalized.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a >= 224) return true;
  return false;
}

function ipv4FromDecimal(host: string): string | null {
  if (!/^\d+$/.test(host)) return null;
  const value = Number(host);
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) return null;
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

function hostName(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

/** Refuse loopback, link-local, and metadata names before the server connects. */
export async function assertFetchTarget(value: string): Promise<URL> {
  const url = assertHttpUrl(value);
  const host = hostName(url);
  if (BLOCKED_NAMES.has(host) || host.endsWith(".localhost")) {
    throw new HttpUrlError("URL host is not allowed");
  }
  const decimal = ipv4FromDecimal(host);
  const literal = decimal || (isIP(host) ? host : "");
  if (literal) {
    if (ipIsBlockedTarget(literal)) throw new HttpUrlError("URL address is not allowed");
    return url;
  }
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new HttpUrlError("URL host did not resolve");
  }
  if (records.length === 0 || records.some((record) => ipIsBlockedTarget(record.address))) {
    throw new HttpUrlError("URL address is not allowed");
  }
  return url;
}

/** Drop credentials when a redirect leaves the original host. */
export function fetchInitForRedirect(init: RequestInit, from: URL, to: URL): RequestInit {
  if (from.host.toLowerCase() === to.host.toLowerCase()) return init;
  const headers = new Headers(init.headers);
  headers.delete("authorization");
  headers.delete("x-api-key");
  headers.delete("cookie");
  return { ...init, headers };
}

export async function safeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const first = await assertFetchTarget(input);
  const response = await fetch(first, { ...init, redirect: "manual" });
  if (response.status < 300 || response.status >= 400) return response;
  const location = response.headers.get("location");
  if (!location) throw new HttpUrlError("Redirect had no location");
  const next = await assertFetchTarget(new URL(location, first).toString());
  return fetch(next, { ...fetchInitForRedirect(init, first, next), redirect: "manual" });
}
