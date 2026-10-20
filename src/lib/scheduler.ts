import { recordSkipped, startScan } from "./jobs";
import { decideScheduled } from "./schedule";
import { getScan } from "./scan";
import { loadRuns, loadSettings, patchRun } from "./store";
import type { SectionId } from "./types";

let ticking = false;

export function startScheduler(): void {
  const holder = globalThis as typeof globalThis & { __vdfScheduler?: boolean };
  if (holder.__vdfScheduler) return;
  holder.__vdfScheduler = true;
  setInterval(() => {
    void tick();
  }, 20_000).unref?.();
  void tick();
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const [settings, runs] = await Promise.all([loadSettings(), loadRuns()]);
    const now = new Date();
    for (const section of ["server", "immich"] as const) {
      const schedule = section === "server" ? settings.server.schedule : settings.immich.schedule;
      const scan = getScan();
      const busy = !scan.running ? "idle" : scan.section === section && scan.trigger === "schedule" ? "this-section-scheduled" : "other";
      const decision = decideScheduled(schedule, now, runs[section], busy);
      if (decision.action === "none") continue;
      if (decision.action === "drop") {
        await dropPending(section, decision.slot, decision.missed);
        continue;
      }
      if (decision.action === "queue") {
        await patchRun(section, { pendingSlot: decision.slot });
        continue;
      }
      await fire(section, decision.slot);
    }
  } finally {
    ticking = false;
  }
}

async function dropPending(section: SectionId, slot: string, missed: boolean): Promise<void> {
  if (missed) await recordSkipped(section, slot);
  else await patchRun(section, { pendingSlot: null });
}

async function fire(section: SectionId, slot: string): Promise<void> {
  // Written before the scan starts, so a stop or crash part-way leaves the slot to run again.
  await patchRun(section, { pendingSlot: slot });
  const started = await startScan(section, "schedule", slot);
  if (!started.ok && started.status !== 409) {
    await patchRun(section, {
      slotKey: slot,
      pendingSlot: null,
      at: new Date().toISOString(),
      status: "error",
      groupCount: null,
      error: started.error,
      trigger: "schedule",
    });
  }
}
