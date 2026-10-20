import { ensurePoster } from "./thumbs";
import { loadResults } from "./store";
import type { SectionId, StoredResults } from "./types";

/** Best item of every group first, so the grid is ready before the viewer's other files. */
export function posterWarmOrder(section: SectionId, results: Pick<StoredResults, "groups">): string[] {
  const covers: string[] = [];
  const rest: string[] = [];
  for (const group of results.groups) {
    const best = group.items.find((item) => item.stackPrimary) ?? group.items[0];
    for (const item of group.items) {
      // Matched Immich assets get their poster from the Immich API, not ffmpeg.
      if (section === "immich" && item.assetId) continue;
      (item === best ? covers : rest).push(item.path);
    }
  }
  return [...covers, ...rest];
}

let generation = 0;

/** Stop the warm-up in flight. Work already queued in ffmpeg is aborted through its signal. */
export function cancelPosterWarmup(): void {
  generation += 1;
}

/**
 * Render card posters in the background at the lowest ffmpeg priority, so the first scroll after a scan
 * finds them on disk. A newer call or `cancelPosterWarmup` stops this one.
 */
export async function warmPosters(section: SectionId, parallelism: number): Promise<void> {
  const mine = ++generation;
  const results = await loadResults(section);
  if (!results || mine !== generation) return;
  const { realResultPath } = await import("./actions");
  const queue = posterWarmOrder(section, results);
  const control = new AbortController();
  const workers = Math.max(1, Math.min(parallelism, 4));
  const run = async () => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      if (mine !== generation) {
        control.abort();
        return;
      }
      try {
        const real = await realResultPath(section, path);
        await ensurePoster(real, parallelism, { priority: "thumbnail", signal: control.signal });
      } catch {
        // A missing or unreadable file only costs its own poster.
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, run));
}
