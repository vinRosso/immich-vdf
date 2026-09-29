/** Run `worker` over `items` with at most `limit` calls in flight. */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldAbort?: () => boolean,
): Promise<void> {
  if (items.length === 0 || shouldAbort?.()) return;
  const workers = Math.max(1, Math.min(Math.max(1, Math.floor(limit) || 1), items.length));
  let cursor = 0;
  async function run(): Promise<void> {
    while (!shouldAbort?.()) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => run()));
}
