import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { ffprobeArgs } from "./ffmpeg-args";
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

export function runProcess(command: string, args: string[]): Promise<void> {
  return capture(command, args).then(() => undefined);
}
