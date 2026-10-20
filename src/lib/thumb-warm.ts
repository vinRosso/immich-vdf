import { ensurePoster, ensureStrip } from "./thumbs";
import { probeFile } from "./probe";
import { loadResults, loadSettings } from "./store";
import type { SectionId, StoredResults } from "./types";

export type WarmTask = { kind: "poster" | "probe" | "strip"; path: string };

/**
 * What to prepare after a scan, in the order the UI needs it: every group's cover poster, then each
 * video's probe and filmstrip, then the remaining posters. Matched Immich assets get their poster from
 * the Immich API, not ffmpeg, so they are skipped.
 */
export function warmPlan(section: SectionId, results: Pick<StoredResults, "groups">): WarmTask[] {
  const covers: WarmTask[] = [];
  const videos: WarmTask[] = [];
  const rest: WarmTask[] = [];
  for (const group of results.groups) {
    const best = group.items.find((item) => item.stackPrimary) ?? group.items[0];
    for (const item of group.items) {
      const servedByImmich = section === "immich" && Boolean(item.assetId);
      if (!servedByImmich) (item === best ? covers : rest).push({ kind: "poster", path: item.path });
      if (!item.isImage) {
        videos.push({ kind: "probe", path: item.path }, { kind: "strip", path: item.path });
      }
    }
  }
  return [...covers, ...videos, ...rest];
}

let generation = 0;

/** Stop the warm-up in flight. Work already queued in ffmpeg is aborted through its signal. */
export function cancelPosterWarmup(): void {
  generation += 1;
}

/**
 * Prepare posters, probes and filmstrips in the background so opening a group finds them ready. It runs
 * one task at a time on the idle lanes, so it never delays a request from the UI. Finished outputs are
 * skipped, which makes it safe to run again after a restart. A newer call or `cancelPosterWarmup` stops it.
 */
export async function warmSections(sections: SectionId[]): Promise<void> {
  const mine = ++generation;
  const control = new AbortController();
  const { realResultPath } = await import("./actions");
  const settings = await loadSettings();
  for (const section of sections) {
    const results = await loadResults(section);
    if (!results) continue;
    const parallelism = settings[section].scan.parallelism;
    for (const task of warmPlan(section, results)) {
      if (mine !== generation) {
        control.abort();
        return;
      }
      try {
        const real = await realResultPath(section, task.path);
        if (task.kind === "probe") await probeFile(real, "background");
        else if (task.kind === "strip") await ensureStrip(real, 0, parallelism, { priority: "idle", signal: control.signal });
        else await ensurePoster(real, parallelism, { priority: "idle", signal: control.signal });
      } catch {
        // A missing or unreadable file only costs its own output.
      }
    }
  }
}
