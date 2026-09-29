/** Hard ceiling for Parallel: three quarters of the logical cores, at least 1. */
export function maxScanParallelism(cores: number): number {
  const count = Math.max(1, Math.floor(cores));
  return Math.max(1, Math.floor((count * 3) / 4));
}

/** Default Parallel: a quarter of the cores, never above the three-quarter ceiling. */
export function suggestScanParallelism(cores: number): number {
  const max = maxScanParallelism(cores);
  return Math.min(max, Math.max(1, Math.floor(Math.max(1, cores) / 4)));
}

export function clampScanParallelism(value: number, cores: number): number {
  const max = maxScanParallelism(cores);
  if (!Number.isFinite(value)) return suggestScanParallelism(cores);
  return Math.min(max, Math.max(1, Math.round(value)));
}
