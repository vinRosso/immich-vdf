type Bucket = { failures: number; resetAt: number };

function buckets(): Map<string, Bucket> {
  const holder = globalThis as typeof globalThis & { __vdfLoginBuckets?: Map<string, Bucket> };
  if (!holder.__vdfLoginBuckets) holder.__vdfLoginBuckets = new Map();
  return holder.__vdfLoginBuckets;
}

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 5;

export function loginAllowed(ip: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
  const bucket = buckets().get(ip);
  if (!bucket || now > bucket.resetAt) return { ok: true };
  if (bucket.failures >= LIMIT) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { ok: true };
}

export function recordLoginFailure(ip: string, now = Date.now()): void {
  const map = buckets();
  const bucket = map.get(ip);
  if (!bucket || now > bucket.resetAt) map.set(ip, { failures: 1, resetAt: now + WINDOW_MS });
  else bucket.failures += 1;
}

export function clearLoginFailures(ip: string): void {
  buckets().delete(ip);
}
