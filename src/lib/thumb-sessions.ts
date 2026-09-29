import type { SectionId } from "./types";

type PathEntry = {
  controller: AbortController;
  refs: number;
};

function store(): Map<string, PathEntry> {
  const holder = globalThis as typeof globalThis & { __vdfThumbPaths?: Map<string, PathEntry> };
  if (!holder.__vdfThumbPaths) holder.__vdfThumbPaths = new Map();
  return holder.__vdfThumbPaths;
}

export function resetThumbSessionsForTests(): void {
  const holder = globalThis as typeof globalThis & { __vdfThumbPaths?: Map<string, PathEntry> };
  holder.__vdfThumbPaths = new Map();
}

/** Drop queued and in-flight ffmpeg thumbnail work for these resolved media paths. */
export async function cancelThumbJobs(section: SectionId, paths: string[]): Promise<void> {
  const { realResultPath } = await import("./actions");
  const resolved: string[] = [];
  for (const candidate of paths) {
    try {
      resolved.push(await realResultPath(section, candidate));
    } catch {
      // Path may already be gone from results.
    }
  }
  cancelThumbWork(resolved);
}

export function cancelThumbWork(paths: string[]): void {
  const pathsByKey = store();
  for (const file of paths) {
    const key = file.trim();
    if (!key) continue;
    pathsByKey.get(key)?.controller.abort();
    pathsByKey.delete(key);
  }
}

/** Per-path dismiss signal combined with the HTTP client disconnect signal. */
export function thumbRequestSignal(
  file: string,
  client?: AbortSignal,
): { signal: AbortSignal; release: () => void } {
  const key = file.trim();
  const paths = store();
  let entry = paths.get(key);
  if (!entry || entry.controller.signal.aborted) {
    entry = { controller: new AbortController(), refs: 0 };
    paths.set(key, entry);
  }
  entry.refs += 1;
  const signal = mergeAbortSignals(entry.controller.signal, client);
  const release = () => {
    const current = paths.get(key);
    if (!current || current !== entry) return;
    current.refs -= 1;
    if (current.refs <= 0) paths.delete(key);
  };
  return { signal, release };
}

function mergeAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const active = signals.filter((value): value is AbortSignal => value != null);
  if (active.length === 0) return new AbortController().signal;
  if (active.length === 1) return active[0];
  const any = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof any === "function") return any(active);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}
