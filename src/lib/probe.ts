import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { ffprobeArgs, ffprobeBitDepthArgs } from "./ffmpeg-args";
import { imageBitDepthFromFfprobe } from "./image-bit-depth";
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

export async function probeImageBitDepth(file: string): Promise<number> {
  const key = await fileCacheKey(file);
  const dir = path.join(loadConfig().dataDir, "probe");
  const fullPath = path.join(dir, `${key}.json`);
  const depthPath = path.join(dir, `${key}.depth.json`);
  try {
    return imageBitDepthFromFfprobe(JSON.parse(await readFile(fullPath, "utf8")));
  } catch {
    // Full playback probe is absent. A bit-depth sidecar is enough.
  }
  try {
    const cached = JSON.parse(await readFile(depthPath, "utf8")) as { bitDepth?: unknown };
    if (typeof cached.bitDepth === "number" && Number.isFinite(cached.bitDepth)) return cached.bitDepth;
  } catch {
    // Cache miss. Probe the first video stream only.
  }
  const stdout = await capture(ffprobeBin(), ffprobeBitDepthArgs(file));
  const bitDepth = imageBitDepthFromFfprobe(JSON.parse(stdout) as unknown);
  await mkdir(dir, { recursive: true });
  await writeFile(depthPath, JSON.stringify({ bitDepth }));
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

export function capture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString("utf8"));
      else reject(new Error(Buffer.concat(err).toString("utf8").trim() || `${command} exited ${code}`));
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
