import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { exclusive, readJson, writeJson } from "./json-file";

const COOKIE = "vdf_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

type SecretState = { value: string | null };

function secretState(): SecretState {
  const holder = globalThis as typeof globalThis & { __vdfSecret?: SecretState };
  if (!holder.__vdfSecret) holder.__vdfSecret = { value: null };
  return holder.__vdfSecret;
}

export async function sessionSecret(): Promise<string> {
  const state = secretState();
  if (state.value) return state.value;
  const file = path.join(loadConfig().dataDir, "session-secret");
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (existing.length >= 32) {
      state.value = existing;
      return existing;
    }
  } catch {
    // Generated on first start and kept on the data volume.
  }
  const created = randomBytes(32).toString("hex");
  await writeFile(file, created, { mode: 0o600 });
  state.value = created;
  return created;
}

export function issueToken(secret: string, expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt, jti: randomBytes(16).toString("hex") })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function tokenBody(token: string): { exp?: number; jti?: string } | null {
  const payload = token.split(".")[0];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number; jti?: string };
  } catch {
    return null;
  }
}

export function tokenId(token: string): string | null {
  const body = tokenBody(token);
  return body && typeof body.jti === "string" && body.jti ? body.jti : null;
}

export function verifyToken(secret: string, token: string, now = Date.now()): boolean {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    return typeof body.exp === "number" && body.exp > now;
  } catch {
    return false;
  }
}

export function passwordsMatch(input: string, expected: string): boolean {
  const left = createHash("sha256").update(input).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function sessionCookie(token: string, secure: boolean): string {
  const parts = [
    `${COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(secure: boolean): string {
  const parts = [`${COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readCookie(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

type RevokedFile = { entries: { id: string; exp: number }[] };

const revokedState = { ids: new Set<string>(), loaded: false };

function revokedPath(): string {
  return path.join(loadConfig().dataDir, "revoked-sessions.json");
}

export function resetSessionRevocationForTests(): void {
  revokedState.ids = new Set();
  revokedState.loaded = false;
}

async function revokedIds(now = Date.now()): Promise<Set<string>> {
  if (revokedState.loaded) return revokedState.ids;
  const file = await readJson<RevokedFile>(revokedPath(), { entries: [] });
  const ids = new Set<string>();
  for (const entry of file.entries) {
    if (entry && entry.exp > now && entry.id) ids.add(entry.id);
  }
  revokedState.ids = ids;
  revokedState.loaded = true;
  return ids;
}

/** Forget this cookie until it would have expired. Other browsers stay signed in. */
export async function revokeToken(token: string): Promise<void> {
  const id = tokenId(token);
  const body = tokenBody(token);
  const exp = body && typeof body.exp === "number" ? body.exp : 0;
  if (!id || exp <= Date.now()) return;
  await exclusive(async () => {
    const now = Date.now();
    const file = await readJson<RevokedFile>(revokedPath(), { entries: [] });
    const entries = file.entries.filter((entry) => entry.exp > now && entry.id !== id);
    entries.push({ id, exp });
    await writeJson(revokedPath(), { entries });
    revokedState.ids.add(id);
    revokedState.loaded = true;
  });
}

export async function cookieIsValid(header: string | null | undefined): Promise<boolean> {
  const token = readCookie(header);
  if (!token) return false;
  if (!verifyToken(await sessionSecret(), token)) return false;
  const id = tokenId(token);
  if (!id) return false;
  return !(await revokedIds()).has(id);
}

export function sessionExpiry(now = Date.now()): number {
  return now + MAX_AGE_SECONDS * 1000;
}
