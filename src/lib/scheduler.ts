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
        await dropPending(section, decision.slot, decision.missed, decision.tooManyTries === true);
        continue;
      }
      if (decision.action === "queue") {
        await patchRun(section, { pendingSlot: decision.slot, pendingAttempts: 0 });
        continue;
      }
      const run = runs[section];
      await fire(section, decision.slot, run.pendingSlot === decision.slot ? (run.pendingAttempts ?? 0) : 0);
    }
  } finally {
    ticking = false;
  }
}

async function dropPending(section: SectionId, slot: string, missed: boolean, tooManyTries: boolean): Promise<void> {
  if (tooManyTries) await recordSkipped(section, slot, "Given up: the server stopped during each of the last attempts to run it");
  else if (missed) await recordSkipped(section, slot);
  else await patchRun(section, { pendingSlot: null, pendingAttempts: 0 });
}

async function fire(section: SectionId, slot: string, attempts: number): Promise<void> {
  // Written before the scan starts, so a stop or crash part-way leaves the slot to run again, a limited number of times.
  await patchRun(section, { pendingSlot: slot, pendingAttempts: attempts + 1 });
  const started = await startScan(section, "schedule", slot);
  if (!started.ok && started.status === 409) {
    // Another scan got in first, so this was not an attempt.
    await patchRun(section, { pendingAttempts: attempts });
  }
  if (!started.ok && started.status !== 409) {
    await patchRun(section, {
      slotKey: slot,
      pendingSlot: null,
      pendingAttempts: 0,
      at: new Date().toISOString(),
      status: "error",
      groupCount: null,
      error: started.error,
      trigger: "schedule",
    });
  }
}
