import { loadConfig } from "./config";
import { maxScanParallelism } from "./scan-parallelism";

type Job = () => Promise<void>;

type Queued = {
  priority: number;
  run: () => void;
};

type PoolState = {
  active: number;
  thumbs: number;
  queue: Queued[];
};

/** Matches encodePriority("playback"). Thumb work yields one slot when more than one is allowed. */
const PLAYBACK_PRIORITY = 0;

function state(): PoolState {
  const holder = globalThis as typeof globalThis & { __vdfPool?: PoolState };
  if (
    !holder.__vdfPool ||
    typeof holder.__vdfPool.thumbs !== "number" ||
    !Array.isArray(holder.__vdfPool.queue) ||
    holder.__vdfPool.queue.some((entry) => typeof entry?.priority !== "number")
  ) {
    holder.__vdfPool = { active: 0, thumbs: 0, queue: [] };
  }
  return holder.__vdfPool;
}

export function resetFfmpegPoolForTests(): void {
  const holder = globalThis as typeof globalThis & { __vdfPool?: PoolState };
  holder.__vdfPool = { active: 0, thumbs: 0, queue: [] };
}

export function ffmpegSlots(limit: number): number {
  const max = maxScanParallelism(loadConfig().cpuCount);
  const requested = Number.isFinite(limit) ? Math.floor(limit) : 1;
  return Math.min(max, Math.max(1, requested));
}

/**
 * Lower runs first: playback, then open-group stills, then filmstrip frames, then cover posters.
 * Jobs that have not started can be removed by aborting their signal.
 * When more than one slot is allowed, one stays free for playback.
 */
export function enqueueFfmpeg(
  limit: number,
  job: Job,
  options?: { priority?: "thumb" | "strip" | "playback" | "viewer" | "thumbnail"; signal?: AbortSignal },
): Promise<void> {
  const pool = state();
  const priority = encodePriority(options?.priority);
  const signal = options?.signal;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const queuedAt = performance.now();
    let taken = false;
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error instanceof Error ? error : new Error("ffmpeg failed"));
      else resolve();
    };
    const run = () => {
      taken = true;
      if (signal?.aborted) {
        finish();
        pump(limit);
        return;
      }
      pool.active += 1;
      if (priority !== PLAYBACK_PRIORITY) pool.thumbs += 1;
      const started = performance.now();
      job()
        .then(() => finish(), (error: unknown) => finish(error))
        .finally(() => {
          pool.active -= 1;
          if (priority !== PLAYBACK_PRIORITY) pool.thumbs -= 1;
          if (process.env.VDF_TIMING === "1") {
            const now = performance.now();
            console.log(
              `[ffmpeg] ${options?.priority ?? "thumbnail"} waited ${(started - queuedAt).toFixed(0)}ms ran ${(now - started).toFixed(0)}ms queue ${pool.queue.length} active ${pool.active}`,
            );
          }
          pump(limit);
        });
    };
    const queued = { priority, run };
    const cancel = () => {
      if (taken) return;
      const index = pool.queue.indexOf(queued);
      if (index >= 0) pool.queue.splice(index, 1);
      finish();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    const index = pool.queue.findIndex((entry) => entry.priority > priority);
    if (index === -1) pool.queue.push(queued);
    else pool.queue.splice(index, 0, queued);
    pump(limit);
  });
}

function encodePriority(priority: "thumb" | "strip" | "playback" | "viewer" | "thumbnail" | undefined): number {
  if (priority === "playback") return PLAYBACK_PRIORITY;
  if (priority === "thumb" || priority === "viewer") return 1;
  if (priority === "strip") return 2;
  return 3;
}

function pump(limit: number): void {
  const pool = state();
  const cap = ffmpegSlots(limit);
  const thumbCap = cap <= 1 ? cap : cap - 1;
  while (pool.queue.length > 0 && pool.active < cap) {
    const next = pool.queue[0];
    if (!next) break;
    if (next.priority !== PLAYBACK_PRIORITY && pool.thumbs >= thumbCap) break;
    pool.queue.shift();
    next.run();
  }
}
