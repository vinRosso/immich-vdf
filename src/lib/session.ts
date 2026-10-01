import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { exclusive, readJson, writeJson } from "./json-file";

const COOKIE = "vdf_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

type SecretState = { value: string | null };
type EpochState = { key: string; value: string };
type EpochFile = { passwordTag: string; epoch: string };
type TokenBody = { exp?: number; jti?: string; epoch?: string };

function secretState(): SecretState {
  const holder = globalThis as typeof globalThis & { __vdfSecret?: SecretState };
  if (!holder.__vdfSecret) holder.__vdfSecret = { value: null };
  return holder.__vdfSecret;
}

function epochState(): EpochState {
  const holder = globalThis as typeof globalThis & { __vdfEpoch?: EpochState };
  if (!holder.__vdfEpoch) holder.__vdfEpoch = { key: "", value: "" };
  return holder.__vdfEpoch;
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

export function issueToken(secret: string, expiresAt: number, epoch = ""): string {
  const body: TokenBody = { exp: expiresAt, jti: randomBytes(16).toString("hex") };
  if (epoch) body.epoch = epoch;
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function tokenBody(token: string): TokenBody | null {
  const payload = token.split(".")[0];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenBody;
  } catch {
    return null;
  }
}

export function tokenId(token: string): string | null {
  const body = tokenBody(token);
  return body && typeof body.jti === "string" && body.jti ? body.jti : null;
}

export function verifyToken(secret: string, token: string, now = Date.now(), epoch?: string): boolean {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenBody;
    if (epoch !== undefined && body.epoch !== epoch) return false;
    return typeof body.exp === "number" && body.exp > now;
  } catch {
    return false;
  }
}

function passwordTag(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

/** Rotates when APP_PASSWORD changes, which invalidates every issued cookie. */
export async function sessionEpoch(): Promise<string> {
  const config = loadConfig();
  const tag = passwordTag(config.password);
  const cacheKey = `${config.dataDir}\0${tag}`;
  const state = epochState();
  if (state.key === cacheKey && state.value) return state.value;
  const file = path.join(config.dataDir, "session-epoch");
  const epoch = await exclusive(async () => {
    let parsed: EpochFile | null = null;
    try {
      parsed = JSON.parse(await readFile(file, "utf8")) as EpochFile;
    } catch {
      parsed = null;
    }
    if (parsed && parsed.passwordTag === tag && /^[a-f0-9]{32}$/.test(parsed.epoch)) return parsed.epoch;
    const created = randomBytes(16).toString("hex");
    await mkdir(config.dataDir, { recursive: true });
    await writeFile(file, JSON.stringify({ passwordTag: tag, epoch: created }), { mode: 0o600 });
    return created;
  });
  state.key = cacheKey;
  state.value = epoch;
  return epoch;
}

export function resetSessionCachesForTests(): void {
  secretState().value = null;
  const state = epochState();
  state.key = "";
  state.value = "";
  resetSessionRevocationForTests();
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
  if (!verifyToken(await sessionSecret(), token, Date.now(), await sessionEpoch())) return false;
  const id = tokenId(token);
  if (!id) return false;
  return !(await revokedIds()).has(id);
}

export function sessionExpiry(now = Date.now()): number {
  return now + MAX_AGE_SECONDS * 1000;
}
