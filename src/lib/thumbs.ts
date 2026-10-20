import { access } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { ffmpegBin, fileCacheKey, probeFile, runProcess } from "./probe";
import { enqueueFfmpeg } from "./ffmpeg-pool";
import { filmstripArgs, posterArgs, posterTime, sampleTimes, STRIP_FRAMES, viewArgs } from "./ffmpeg-args";
import { loadSettings } from "./store";
import type { SectionId } from "./types";

const STILL_IMAGE = /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;

const madeDirs = new Set<string>();

async function dirFor(file: string): Promise<string> {
  const key = await fileCacheKey(file);
  const dir = path.join(loadConfig().dataDir, "thumbs", key);
  if (!madeDirs.has(dir)) {
    await mkdir(dir, { recursive: true });
    madeDirs.add(dir);
  }
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
  priority?: "thumb" | "strip" | "viewer" | "thumbnail";
  signal?: AbortSignal;
};

type FlightEntry = {
  promise: Promise<string>;
  refs: number;
  work: AbortController;
};

const thumbFlights = new Map<string, FlightEntry>();

/**
 * Share one encode across callers. Abort the work only when every waiter has aborted.
 * A cancelled client does not fail waiters that are still connected.
 */
function singleFlight(key: string, run: (signal: AbortSignal) => Promise<string>, caller?: AbortSignal): Promise<string> {
  let entry = thumbFlights.get(key);
  if (!entry || entry.work.signal.aborted) {
    const work = new AbortController();
    const promise = run(work.signal).finally(() => {
      const current = thumbFlights.get(key);
      if (current?.promise === promise) thumbFlights.delete(key);
    });
    entry = { promise, refs: 0, work };
    thumbFlights.set(key, entry);
  }
  const flight = entry;
  flight.refs += 1;
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, value?: string) => {
      if (settled) return;
      settled = true;
      caller?.removeEventListener("abort", onAbort);
      flight.refs -= 1;
      if (error) reject(error instanceof Error ? error : new Error("Thumbnail failed"));
      else resolve(value ?? "");
    };
    const onAbort = () => {
      if (flight.refs <= 1) flight.work.abort();
      finish(new ThumbnailCancelled());
    };
    if (caller?.aborted) {
      onAbort();
      return;
    }
    caller?.addEventListener("abort", onAbort, { once: true });
    flight.promise.then(
      (value) => finish(undefined, value),
      (error: unknown) => finish(error),
    );
  });
}

export async function ensurePoster(file: string, parallelism: number, options?: ThumbRender): Promise<string> {
  const dir = await dirFor(file);
  const output = path.join(dir, "poster.jpg");
  if (await exists(output)) return output;
  return singleFlight(
    `poster\0${file}`,
    async (signal) => {
      if (await exists(output)) return output;
      // A still has no duration, so skip the ffprobe spawn.
      const duration = STILL_IMAGE.test(file) ? 0 : await probeFile(file).then((probe) => probe.duration).catch(() => 0);
      await renderThumb(parallelism, output, posterArgs(file, posterTime(duration), output), {
        priority: options?.priority,
        signal,
      });
      return output;
    },
    options?.signal,
  );
}

export async function ensureView(file: string, parallelism: number, options?: ThumbRender): Promise<string> {
  const dir = await dirFor(file);
  const output = path.join(dir, "view.jpg");
  if (await exists(output)) return output;
  return singleFlight(
    `view\0${file}`,
    async (signal) => {
      if (await exists(output)) return output;
      await renderThumb(parallelism, output, viewArgs(file, output), { priority: options?.priority, signal });
      return output;
    },
    options?.signal,
  );
}

export async function ensureStrip(file: string, index: number, parallelism: number, options?: ThumbRender): Promise<string> {
  if (!Number.isInteger(index) || index < 0 || index >= STRIP_FRAMES) {
    throw new Error("Unknown filmstrip frame");
  }
  const dir = await dirFor(file);
  const output = path.join(dir, `strip-${index}.jpg`);
  if (await exists(output)) return output;
  return singleFlight(
    `strip\0${file}\0${index}`,
    async (signal) => {
      if (await exists(output)) return output;
      const duration = await probeFile(file).then((probe) => probe.duration).catch(() => 0);
      const times = sampleTimes(duration, STRIP_FRAMES);
      await renderThumb(parallelism, output, filmstripArgs(file, times[index] ?? 0, output), {
        priority: options?.priority,
        signal,
      });
      return output;
    },
    options?.signal,
  );
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
