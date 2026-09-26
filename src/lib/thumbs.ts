import { access } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { ffmpegBin, fileCacheKey, probeFile, runProcess } from "./probe";
import { enqueueFfmpeg } from "./ffmpeg-pool";
import { filmstripArgs, posterArgs, posterTime, sampleTimes, STRIP_FRAMES } from "./ffmpeg-args";
import { loadSettings } from "./store";

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

export async function ensurePoster(file: string): Promise<string> {
  const dir = await dirFor(file);
  const output = path.join(dir, "poster.jpg");
  if (await exists(output)) return output;
  const duration = await probeFile(file).then((probe) => probe.duration).catch(() => 0);
  const settings = await loadSettings();
  await enqueueFfmpeg(settings.server.ffmpegConcurrency, () =>
    runProcess(ffmpegBin(), posterArgs(file, posterTime(duration), output)),
  );
  return output;
}

export async function ensureStrip(file: string, index: number): Promise<string> {
  if (!Number.isInteger(index) || index < 0 || index >= STRIP_FRAMES) {
    throw new Error("Unknown filmstrip frame");
  }
  const dir = await dirFor(file);
  const output = path.join(dir, `strip-${index}.jpg`);
  if (await exists(output)) return output;
  const duration = await probeFile(file).then((probe) => probe.duration).catch(() => 0);
  const times = sampleTimes(duration, STRIP_FRAMES);
  const settings = await loadSettings();
  await enqueueFfmpeg(settings.server.ffmpegConcurrency, () =>
    runProcess(ffmpegBin(), filmstripArgs(file, times[index] ?? 0, output)),
  );
  return output;
}

export function queueThumbnails(files: string[]): void {
  for (const file of files) {
    void ensurePoster(file).catch(() => undefined);
    for (let index = 0; index < STRIP_FRAMES; index += 1) {
      void ensureStrip(file, index).catch(() => undefined);
    }
  }
}
