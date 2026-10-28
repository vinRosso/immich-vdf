import { access } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { ffmpegBin, fileCacheKey, probeFile, runProcess } from "./probe";
import { encodePriority, enqueueFfmpeg, type EncodeLane, type SetLane } from "./ffmpeg-pool";
import { filmstripBatchArgs, posterArgs, posterTime, sampleTimes, STRIP_FRAMES, viewArgs } from "./ffmpeg-args";
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
  priority?: EncodeLane;
  signal?: AbortSignal;
  onQueued?: (setLane: SetLane) => void;
};

/** The lanes of the callers still waiting on one encode. The queued job runs in the most urgent of them. */
type FlightLanes = {
  waiting: Set<{ lane: EncodeLane }>;
  setLane: SetLane | null;
};

type FlightEntry = {
  promise: Promise<string>;
  work: AbortController;
  lanes: FlightLanes;
};

type FlightRun = (signal: AbortSignal, onQueued: (setLane: SetLane) => void) => Promise<string>;

const thumbFlights = new Map<string, FlightEntry>();

function retune(lanes: FlightLanes): void {
  let urgent: EncodeLane | null = null;
  for (const { lane } of lanes.waiting) {
    if (urgent === null || encodePriority(lane) < encodePriority(urgent)) urgent = lane;
  }
  if (urgent) lanes.setLane?.(urgent);
}

/**
 * Share one encode across callers. Abort the work only when every waiter has aborted.
 * A cancelled client does not fail waiters that are still connected.
 * The queued job follows the most urgent caller still waiting, so a viewer request is not stuck behind a prefetch.
 */
export function singleFlight(key: string, run: FlightRun, caller?: AbortSignal, lane: EncodeLane = "thumbnail"): Promise<string> {
  let entry = thumbFlights.get(key);
  if (!entry || entry.work.signal.aborted) {
    const work = new AbortController();
    const lanes: FlightLanes = { waiting: new Set(), setLane: null };
    const promise = run(work.signal, (setLane) => {
      lanes.setLane = setLane;
      retune(lanes);
    }).finally(() => {
      const current = thumbFlights.get(key);
      if (current?.promise === promise) thumbFlights.delete(key);
    });
    entry = { promise, work, lanes };
    thumbFlights.set(key, entry);
  }
  const flight = entry;
  const waiter = { lane };
  flight.lanes.waiting.add(waiter);
  retune(flight.lanes);
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, value?: string) => {
      if (settled) return;
      settled = true;
      caller?.removeEventListener("abort", onAbort);
      flight.lanes.waiting.delete(waiter);
      retune(flight.lanes);
      if (error) reject(error instanceof Error ? error : new Error("Thumbnail failed"));
      else resolve(value ?? "");
    };
    const onAbort = () => {
      if (flight.lanes.waiting.size <= 1) flight.work.abort();
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
    async (signal, onQueued) => {
      if (await exists(output)) return output;
      // A still has no duration, so skip the ffprobe spawn.
      const duration = STILL_IMAGE.test(file) ? 0 : await probeFile(file).then((probe) => probe.duration).catch(() => 0);
      await renderThumb(parallelism, output, posterArgs(file, posterTime(duration), output), {
        priority: options?.priority,
        signal,
        onQueued,
      });
      return output;
    },
    options?.signal,
    options?.priority,
  );
}

export async function ensureView(file: string, parallelism: number, options?: ThumbRender): Promise<string> {
  const dir = await dirFor(file);
  const output = path.join(dir, "view.jpg");
  if (await exists(output)) return output;
  return singleFlight(
    `view\0${file}`,
    async (signal, onQueued) => {
      if (await exists(output)) return output;
      await renderThumb(parallelism, output, viewArgs(file, output), { priority: options?.priority, signal, onQueued });
      return output;
    },
    options?.signal,
    options?.priority,
  );
}

export async function ensureStrip(file: string, index: number, parallelism: number, options?: ThumbRender): Promise<string> {
  if (!Number.isInteger(index) || index < 0 || index >= STRIP_FRAMES) {
    throw new Error("Unknown filmstrip frame");
  }
  const dir = await dirFor(file);
  const output = path.join(dir, `strip-${index}.jpg`);
  if (await exists(output)) return output;
  // One ffmpeg run writes every missing frame, so six frame requests cost one process and one probe.
  await singleFlight(
    `strips\0${file}`,
    async (signal, onQueued) => {
      const missing: { seconds: number; output: string }[] = [];
      const duration = await probeFile(file).then((probe) => probe.duration).catch(() => 0);
      const times = sampleTimes(duration, STRIP_FRAMES);
      for (let frame = 0; frame < STRIP_FRAMES; frame += 1) {
        const target = path.join(dir, `strip-${frame}.jpg`);
        if (!(await exists(target))) missing.push({ seconds: times[frame] ?? 0, output: target });
      }
      if (missing.length > 0) {
        await renderThumb(parallelism, missing[0]!.output, filmstripBatchArgs(file, missing), {
          priority: options?.priority,
          signal,
          onQueued,
        });
      }
      return dir;
    },
    options?.signal,
    options?.priority,
  );
  if (!(await exists(output))) throw new ThumbnailCancelled();
  return output;
}

async function renderThumb(parallelism: number, output: string, args: string[], options?: ThumbRender): Promise<void> {
  await enqueueFfmpeg(parallelism, () => runProcess(ffmpegBin(), args, options?.signal), {
    priority: options?.priority ?? "thumbnail",
    signal: options?.signal,
    onQueued: options?.onQueued,
  });
  if (options?.signal?.aborted || !(await exists(output))) throw new ThumbnailCancelled();
}

export async function sectionParallelism(section: SectionId): Promise<number> {
  const settings = await loadSettings();
  return settings[section].scan.parallelism;
}
