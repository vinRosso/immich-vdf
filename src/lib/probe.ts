import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { ffprobeArgs, ffprobeBitDepthArgs } from "./ffmpeg-args";
import { bitDepthFromHeader, imageBitDepthFromFfprobe } from "./image-bit-depth";
import { parseFfprobe, type ProbeSummary } from "./playback";

export function ffmpegBin(): string {
  return process.env.FFMPEG?.trim() || "ffmpeg";
}

export function ffprobeBin(): string {
  return process.env.FFPROBE?.trim() || "ffprobe";
}

export async function fileCacheKey(file: string): Promise<string> {
  const info = await stat(file);
  return createHash("sha256")
    .update(`${file}\0${info.size}\0${Math.round(info.mtimeMs)}`)
    .digest("hex");
}

const HEADER_CHUNK = 64 * 1024;
const HEADER_MAX = 1024 * 1024;
const FFPROBE_BIT_DEPTH_TIMEOUT_MS = 15_000;

type CachedDepth = { dir: string; depthPath: string; depth: number | null };

async function cachedBitDepth(file: string): Promise<CachedDepth> {
  const key = await fileCacheKey(file);
  const dir = path.join(loadConfig().dataDir, "probe");
  const fullPath = path.join(dir, `${key}.json`);
  const depthPath = path.join(dir, `${key}.depth.json`);
  try {
    const depth = imageBitDepthFromFfprobe(JSON.parse(await readFile(fullPath, "utf8")));
    if (depth > 0) return { dir, depthPath, depth };
  } catch {
    // Full playback probe is absent. A bit-depth sidecar is enough.
  }
  try {
    const cached = JSON.parse(await readFile(depthPath, "utf8")) as { bitDepth?: unknown };
    if (typeof cached.bitDepth === "number" && Number.isFinite(cached.bitDepth)) return { dir, depthPath, depth: cached.bitDepth };
  } catch {
    // Cache miss.
  }
  return { dir, depthPath, depth: null };
}

/** JPEG, PNG, and GIF depth from the file header. No ffprobe. */
async function bitDepthFromImageFile(file: string): Promise<number | null> {
  const handle = await open(file, "r");
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total < HEADER_MAX) {
      const buf = Buffer.alloc(Math.min(HEADER_CHUNK, HEADER_MAX - total));
      const { bytesRead } = await handle.read(buf, 0, buf.length, total);
      if (bytesRead <= 0) break;
      chunks.push(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead));
      total += bytesRead;
      const merged = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, total);
      const parsed = bitDepthFromHeader(merged);
      if (parsed === "more") continue;
      return parsed === "unknown" ? null : parsed;
    }
    return null;
  } finally {
    await handle.close();
  }
}

export async function probeImageBitDepth(file: string, options?: { ffprobe?: boolean }): Promise<number> {
  const slot = await cachedBitDepth(file);
  if (slot.depth !== null && slot.depth > 0) return slot.depth;
  let bitDepth = 0;
  try {
    bitDepth = (await bitDepthFromImageFile(file)) ?? 0;
  } catch {
    bitDepth = 0;
  }
  if (bitDepth > 0) {
    await mkdir(slot.dir, { recursive: true });
    await writeFile(slot.depthPath, JSON.stringify({ bitDepth }));
    return bitDepth;
  }
  if (options?.ffprobe === false) return 0;
  if (slot.depth === 0) return 0;
  const stdout = await capture(ffprobeBin(), ffprobeBitDepthArgs(file), FFPROBE_BIT_DEPTH_TIMEOUT_MS);
  bitDepth = imageBitDepthFromFfprobe(JSON.parse(stdout) as unknown);
  await mkdir(slot.dir, { recursive: true });
  await writeFile(slot.depthPath, JSON.stringify({ bitDepth }));
  return bitDepth;
}

export async function probeFile(file: string): Promise<ProbeSummary> {
  const key = await fileCacheKey(file);
  const cachePath = path.join(loadConfig().dataDir, "probe", `${key}.json`);
  try {
    return parseFfprobe(JSON.parse(await readFile(cachePath, "utf8")));
  } catch {
    // Cache miss or a stale file. Probe again.
  }
  const stdout = await capture(ffprobeBin(), ffprobeArgs(file));
  const parsed = JSON.parse(stdout) as unknown;
  const summary = parseFfprobe(parsed);
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(parsed));
  return summary;
}

export function capture(command: string, args: string[], timeoutMs = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(value ?? "");
    };
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
            finish(new Error(`${command} timed out`));
          }, timeoutMs)
        : undefined;
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) finish(undefined, Buffer.concat(out).toString("utf8"));
      else finish(new Error(Buffer.concat(err).toString("utf8").trim() || `${command} exited ${code}`));
    });
  });
}

export function runProcess(command: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const err: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", stop);
      if (error) reject(error);
      else resolve();
    };
    const stop = () => {
      if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
      finish();
    };
    signal?.addEventListener("abort", stop, { once: true });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (signal?.aborted) finish();
      else if (code === 0) finish();
      else finish(new Error(Buffer.concat(err).toString("utf8").trim() || `${command} exited ${code}`));
    });
  });
}
