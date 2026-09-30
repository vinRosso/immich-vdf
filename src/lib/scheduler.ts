import { recordSkipped, startScan } from "./jobs";
import { dueSlot } from "./schedule";
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
      const slot = dueSlot(schedule, now, runs[section].slotKey);
      if (!slot) continue;
      await fire(section, slot);
    }
  } finally {
    ticking = false;
  }
}

async function fire(section: SectionId, slot: string): Promise<void> {
  const scan = getScan();
  if (scan.running) {
    if (scan.section === section && scan.trigger === "schedule") return;
    await recordSkipped(section, slot);
    return;
  }
  const started = await startScan(section, "schedule", slot);
  if (!started.ok && started.status !== 409) {
    await patchRun(section, {
      slotKey: slot,
      at: new Date().toISOString(),
      status: "error",
      groupCount: null,
      error: started.error,
      trigger: "schedule",
    });
  }
}
