export type ProbeLane = "interactive" | "background";

export type LaneJob<T> = {
  promise: Promise<T>;
  /** Move a queued background job to the interactive lane. A running job is unaffected. */
  promote: () => void;
};

type Entry = {
  lane: ProbeLane;
  start: () => void;
};

export type LaneQueue = {
  run: <T>(lane: ProbeLane, task: () => Promise<T>) => LaneJob<T>;
  stats: () => { active: number; waiting: number };
};

/**
 * Runs at most `limit` tasks at once. Interactive tasks always start first, and background tasks leave
 * one slot free (when there is more than one) so a request that arrives later does not wait behind them.
 */
export function createLaneQueue(limit: () => number): LaneQueue {
  const waiting: Entry[] = [];
  let active = 0;

  function pump(): void {
    const cap = Math.max(1, limit());
    while (active < cap) {
      let index = waiting.findIndex((entry) => entry.lane === "interactive");
      if (index < 0) {
        if (waiting.length === 0 || active >= Math.max(1, cap - 1)) return;
        index = 0;
      }
      const [entry] = waiting.splice(index, 1);
      active += 1;
      entry!.start();
    }
  }

  return {
    run<T>(lane: ProbeLane, task: () => Promise<T>): LaneJob<T> {
      let entry!: Entry;
      const promise = new Promise<T>((resolve, reject) => {
        entry = {
          lane,
          start: () => {
            let running: Promise<T>;
            try {
              running = task();
            } catch (error) {
              running = Promise.reject(error);
            }
            running.then(resolve, reject).finally(() => {
              active -= 1;
              pump();
            });
          },
        };
      });
      waiting.push(entry);
      pump();
      return {
        promise,
        promote: () => {
          if (entry.lane === "interactive") return;
          entry.lane = "interactive";
          pump();
        },
      };
    },
    stats: () => ({ active, waiting: waiting.length }),
  };
}

/** Once this many failures are remembered, the expired ones are dropped. */
const FAILURE_PRUNE_AT = 500;

export type CachedLoader<V> = {
  get: (key: string, arg: string, lane: ProbeLane) => Promise<V>;
  size: () => number;
};

/**
 * One load per key at a time, an in-memory LRU of results, and a short memory of failures so a broken
 * file does not respawn the tool on every request. Keys must change when the file changes.
 */
export function createCachedLoader<V>(options: {
  queue: LaneQueue;
  load: (arg: string) => Promise<V>;
  maxEntries: number;
  failureTtlMs: number;
  now?: () => number;
}): CachedLoader<V> {
  const now = options.now ?? Date.now;
  const memory = new Map<string, V>();
  const failures = new Map<string, { until: number; error: Error }>();
  const flights = new Map<string, LaneJob<V>>();

  return {
    get(key, arg, lane) {
      if (memory.has(key)) {
        const value = memory.get(key) as V;
        memory.delete(key);
        memory.set(key, value);
        return Promise.resolve(value);
      }
      const failed = failures.get(key);
      if (failed) {
        if (failed.until > now()) return Promise.reject(failed.error);
        failures.delete(key);
      }
      const flight = flights.get(key);
      if (flight) {
        if (lane === "interactive") flight.promote();
        return flight.promise;
      }
      const job = options.queue.run(lane, () => options.load(arg));
      flights.set(key, job);
      const promise = job.promise.then(
        (value) => {
          flights.delete(key);
          memory.set(key, value);
          while (memory.size > options.maxEntries) memory.delete(memory.keys().next().value as string);
          return value;
        },
        (error: unknown) => {
          flights.delete(key);
          const failure = error instanceof Error ? error : new Error("probe failed");
          failures.set(key, { until: now() + options.failureTtlMs, error: failure });
          if (failures.size > FAILURE_PRUNE_AT) {
            // A failure is only looked up again for the same key, so expired ones would stay for as long as the server runs.
            for (const [failedKey, entry] of failures) if (entry.until <= now()) failures.delete(failedKey);
          }
          throw failure;
        },
      );
      // The entry above replaced the raw job's promise so callers see cache updates before they resume.
      flights.set(key, { promise, promote: job.promote });
      return promise;
    },
    size: () => memory.size,
  };
}
