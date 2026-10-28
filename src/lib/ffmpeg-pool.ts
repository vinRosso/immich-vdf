import { loadConfig } from "./config";
import { getScan } from "./scan";
import { maxScanParallelism } from "./scan-parallelism";

type Job = () => Promise<void>;

export type EncodeLane = "thumb" | "strip" | "playback" | "viewer" | "thumbnail" | "prefetch" | "idle";

/** Moves a job that has not started to another lane, more or less urgent. */
export type SetLane = (lane: EncodeLane) => void;

type Queued = {
  lane: EncodeLane;
  priority: number;
  run: () => void;
};

type PoolState = {
  active: number;
  thumbs: number;
  queue: Queued[];
  scanRunning: () => boolean;
};

type TestPoolOptions = { scanRunning?: boolean | (() => boolean) };

/** Matches encodePriority("playback"). Thumb work yields one slot when more than one is allowed. */
const PLAYBACK_PRIORITY = 0;
/** Background warm-up. Starts only when nothing else is queued or running. */
const IDLE_PRIORITY = 5;

function state(): PoolState {
  const holder = globalThis as typeof globalThis & { __vdfPool?: PoolState };
  if (
    !holder.__vdfPool ||
    typeof holder.__vdfPool.thumbs !== "number" ||
    !Array.isArray(holder.__vdfPool.queue) ||
    holder.__vdfPool.queue.some((entry) => typeof entry?.priority !== "number")
  ) {
    holder.__vdfPool = { active: 0, thumbs: 0, queue: [], scanRunning: () => getScan().running };
  }
  // A pool from before scanRunning existed (a dev reload) keeps its queue, so waiting requests still run.
  if (typeof holder.__vdfPool.scanRunning !== "function") holder.__vdfPool.scanRunning = () => getScan().running;
  return holder.__vdfPool;
}

/** Tests pass a limit and expect it, so the pool acts as if a scan were running unless told otherwise. */
export function resetFfmpegPoolForTests(options?: TestPoolOptions): void {
  const holder = globalThis as typeof globalThis & { __vdfPool?: PoolState };
  const scanRunning = options?.scanRunning ?? true;
  holder.__vdfPool = {
    active: 0,
    thumbs: 0,
    queue: [],
    scanRunning: typeof scanRunning === "function" ? scanRunning : () => scanRunning,
  };
}

/**
 * While a scan runs, the section's Parallel setting, so viewer work does not compete with it.
 * Otherwise three quarters of the cores, or VDF_FFMPEG_SLOTS when set (at most the number of cores).
 */
export function ffmpegSlots(limit: number): number {
  const cores = loadConfig().cpuCount;
  const max = maxScanParallelism(cores);
  if (!state().scanRunning()) {
    const override = Math.floor(Number(process.env.VDF_FFMPEG_SLOTS));
    return override >= 1 ? Math.min(override, cores) : max;
  }
  const requested = Number.isFinite(limit) ? Math.floor(limit) : 1;
  return Math.min(max, Math.max(1, requested));
}

/**
 * Lower runs first: playback, then open-group stills, then filmstrip frames, then posters, then the
 * neighbouring groups the viewer loads ahead.
 * Jobs that have not started can be removed by aborting their signal.
 * When more than one slot is allowed, one stays free for playback.
 * `onQueued` receives a function that moves the job to another lane while it waits.
 */
export function enqueueFfmpeg(
  limit: number,
  job: Job,
  options?: { priority?: EncodeLane; signal?: AbortSignal; onQueued?: (setLane: SetLane) => void },
): Promise<void> {
  const pool = state();
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
      const thumb = queued.priority !== PLAYBACK_PRIORITY;
      pool.active += 1;
      if (thumb) pool.thumbs += 1;
      const started = performance.now();
      job()
        .then(() => finish(), (error: unknown) => finish(error))
        .finally(() => {
          pool.active -= 1;
          if (thumb) pool.thumbs -= 1;
          if (process.env.VDF_TIMING === "1") {
            const now = performance.now();
            console.log(
              `[ffmpeg] ${queued.lane} waited ${(started - queuedAt).toFixed(0)}ms ran ${(now - started).toFixed(0)}ms queue ${pool.queue.length} active ${pool.active}`,
            );
          }
          pump(limit);
        });
    };
    const lane = options?.priority ?? "thumbnail";
    const queued: Queued = { lane, priority: encodePriority(lane), run };
    const cancel = () => {
      if (taken) return;
      const index = pool.queue.indexOf(queued);
      if (index >= 0) pool.queue.splice(index, 1);
      finish();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    insert(pool, queued);
    // After the insert, so a caller can set the lane at once.
    options?.onQueued?.((next) => {
      const priority = encodePriority(next);
      if (taken || settled || priority === queued.priority) return;
      const index = pool.queue.indexOf(queued);
      if (index < 0) return;
      pool.queue.splice(index, 1);
      queued.lane = next;
      queued.priority = priority;
      insert(pool, queued);
      pump(limit);
    });
    pump(limit);
  });
}

/** After every entry of the same or a more urgent lane, so equal lanes stay first come, first served. */
function insert(pool: PoolState, queued: Queued): void {
  const index = pool.queue.findIndex((entry) => entry.priority > queued.priority);
  if (index === -1) pool.queue.push(queued);
  else pool.queue.splice(index, 0, queued);
}

/** Lower is more urgent. */
export function encodePriority(priority: EncodeLane | undefined): number {
  if (priority === "playback") return PLAYBACK_PRIORITY;
  if (priority === "idle") return IDLE_PRIORITY;
  if (priority === "prefetch") return 4;
  if (priority === "thumb" || priority === "viewer") return 1;
  if (priority === "strip") return 2;
  return 3;
}

function pump(limit: number): void {
  const pool = state();
  const cap = ffmpegSlots(limit);
  const thumbCap = cap <= 1 ? cap : cap - 1;
  while (pool.queue.length > 0) {
    // Thumb work above the thumb share (started before a scan lowered the cap) does not hold playback back.
    const busy = pool.active - Math.max(0, pool.thumbs - thumbCap);
    if (busy >= cap) break;
    const next = pool.queue[0];
    if (!next) break;
    if (next.priority !== PLAYBACK_PRIORITY && pool.thumbs >= thumbCap) break;
    // Warm-up never competes: it waits for an empty pool, and only one such job runs at a time.
    if (next.priority === IDLE_PRIORITY && pool.active > 0) break;
    pool.queue.shift();
    next.run();
  }
}
