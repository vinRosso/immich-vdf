type Job = () => Promise<void>;

type PoolState = {
  active: number;
  queue: Array<() => void>;
};

function state(): PoolState {
  const holder = globalThis as typeof globalThis & { __vdfPool?: PoolState };
  if (!holder.__vdfPool) holder.__vdfPool = { active: 0, queue: [] };
  return holder.__vdfPool;
}

export function ffmpegSlots(limit: number): number {
  return Math.min(8, Math.max(1, Math.floor(limit)));
}

export function enqueueFfmpeg(limit: number, job: Job): Promise<void> {
  const pool = state();
  return new Promise((resolve, reject) => {
    const run = () => {
      pool.active += 1;
      job()
        .then(resolve, reject)
        .finally(() => {
          pool.active -= 1;
          pump(limit);
        });
    };
    pool.queue.push(run);
    pump(limit);
  });
}

function pump(limit: number): void {
  const pool = state();
  const cap = ffmpegSlots(limit);
  while (pool.active < cap && pool.queue.length > 0) {
    const next = pool.queue.shift();
    next?.();
  }
}
