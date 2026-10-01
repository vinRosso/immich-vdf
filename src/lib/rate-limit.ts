import path from "node:path";
import { loadConfig } from "./config";
import { exclusive, readJson, writeJson } from "./json-file";

type Buckets = { buckets: Record<string, { failures: number; resetAt: number }> };

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 5;

function attemptsFile(): string {
  return path.join(loadConfig().dataDir, "login-attempts.json");
}

function prune(store: Buckets, now: number): void {
  for (const [ip, bucket] of Object.entries(store.buckets)) {
    if (!bucket || now > bucket.resetAt) delete store.buckets[ip];
  }
}

async function update(
  ip: string,
  now: number,
  change: "check" | "fail" | "clear",
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  return exclusive(async () => {
    const store = await readJson<Buckets>(attemptsFile(), { buckets: {} });
    if (!store.buckets || typeof store.buckets !== "object") store.buckets = {};
    prune(store, now);
    const bucket = store.buckets[ip];
    if (change === "clear") {
      delete store.buckets[ip];
      await writeJson(attemptsFile(), store);
      return { ok: true };
    }
    if (change === "fail") {
      if (!bucket) store.buckets[ip] = { failures: 1, resetAt: now + WINDOW_MS };
      else bucket.failures += 1;
      await writeJson(attemptsFile(), store);
      return { ok: true };
    }
    if (bucket && bucket.failures >= LIMIT) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }
    return { ok: true };
  });
}

export function loginAllowed(ip: string, now = Date.now()): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  return update(ip, now, "check");
}

export function recordLoginFailure(ip: string, now = Date.now()): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  return update(ip, now, "fail");
}

export function clearLoginFailures(ip: string, now = Date.now()): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  return update(ip, now, "clear");
}
