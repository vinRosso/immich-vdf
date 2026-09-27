const holders = new Map<string, AbortController>();

export function playbackKey(value: string | null): string | null {
  if (!value) return null;
  const key = value.trim().slice(0, 80);
  if (!/^[A-Za-z0-9-]{8,80}$/.test(key)) return null;
  return key;
}

/** One in-flight playback per player. A new request for that player cancels the previous ffmpeg. */
export function claimPlayback(id: string | null): { signal: AbortSignal; abort: () => void; release: () => void } {
  const controller = new AbortController();
  const key = playbackKey(id);
  if (!key) {
    return { signal: controller.signal, abort: () => controller.abort(), release: () => undefined };
  }
  holders.get(key)?.abort();
  holders.set(key, controller);
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    release: () => {
      if (holders.get(key) === controller) holders.delete(key);
    },
  };
}
