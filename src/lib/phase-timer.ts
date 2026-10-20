/** Wall time per scan step, logged as it finishes and saved with the run. */
export class PhaseTimer {
  private readonly phases: Record<string, number> = {};

  constructor(
    private readonly log: (line: string) => void,
    private readonly now: () => number = Date.now,
  ) {}

  async time<T>(name: string, work: () => Promise<T>): Promise<T> {
    const started = this.now();
    try {
      return await work();
    } finally {
      this.add(name, this.now() - started);
    }
  }

  add(name: string, ms: number): void {
    const elapsed = Math.max(0, Math.round(ms));
    this.phases[name] = (this.phases[name] ?? 0) + elapsed;
    this.log(`[scan] ${name} took ${formatPhaseSeconds(elapsed)}`);
  }

  record(): Record<string, number> {
    return { ...this.phases };
  }

  summary(): string {
    const parts = Object.entries(this.phases).map(([name, ms]) => `${name} ${formatPhaseSeconds(ms)}`);
    return parts.length === 0 ? "" : `[scan] Timings: ${parts.join(", ")}`;
  }
}

export function formatPhaseSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
