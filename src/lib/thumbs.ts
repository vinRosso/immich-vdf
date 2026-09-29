import { access } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { ffmpegBin, fileCacheKey, probeFile, runProcess } from "./probe";
import { enqueueFfmpeg } from "./ffmpeg-pool";
import { filmstripArgs, posterArgs, posterTime, sampleTimes, STRIP_FRAMES } from "./ffmpeg-args";
import { loadSettings } from "./store";
import type { SectionId } from "./types";

async function dirFor(file: string): Promise<string> {
  const key = await fileCacheKey(file);
  const dir = path.join(loadConfig().dataDir, "thumbs", key);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export class ThumbnailCancelled extends Error {
  constructor() {
    super("Thumbnail cancelled");
    this.name = "ThumbnailCancelled";
  }
}

type ThumbRender = {
  priority?: "viewer" | "thumbnail";
  signal?: AbortSignal;
};

export async function ensurePoster(file: string, parallelism: number, options?: ThumbRender): Promise<string> {
  const dir = await dirFor(file);
  const output = path.join(dir, "poster.jpg");
  if (await exists(output)) return output;
  const duration = await probeFile(file).then((probe) => probe.duration).catch(() => 0);
  await renderThumb(parallelism, output, posterArgs(file, posterTime(duration), output), options);
  return output;
}

export async function ensureStrip(file: string, index: number, parallelism: number, options?: ThumbRender): Promise<string> {
  if (!Number.isInteger(index) || index < 0 || index >= STRIP_FRAMES) {
    throw new Error("Unknown filmstrip frame");
  }
  const dir = await dirFor(file);
  const output = path.join(dir, `strip-${index}.jpg`);
  if (await exists(output)) return output;
  const duration = await probeFile(file).then((probe) => probe.duration).catch(() => 0);
  const times = sampleTimes(duration, STRIP_FRAMES);
  await renderThumb(parallelism, output, filmstripArgs(file, times[index] ?? 0, output), options);
  return output;
}

async function renderThumb(parallelism: number, output: string, args: string[], options?: ThumbRender): Promise<void> {
  await enqueueFfmpeg(parallelism, () => runProcess(ffmpegBin(), args, options?.signal), {
    priority: options?.priority ?? "thumbnail",
    signal: options?.signal,
  });
  if (options?.signal?.aborted || !(await exists(output))) throw new ThumbnailCancelled();
}

export async function sectionParallelism(section: SectionId): Promise<number> {
  const settings = await loadSettings();
  return settings[section].scan.parallelism;
}
