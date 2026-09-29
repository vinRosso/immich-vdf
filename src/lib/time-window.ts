/** Same curve as engine/VDF.Core/TimeWindow.BufferDays. 0 means the whole library. */
export function bufferDays(windowDays: number): number {
  if (!Number.isFinite(windowDays) || windowDays <= 0) return 0;
  return (windowDays / 3) * (90 / (90 + windowDays));
}

export function timeWindowHint(windowDays: number): string {
  if (windowDays <= 0) return "All dates. Every file is compared with every other file.";
  const buffer = bufferDays(windowDays);
  const shown = buffer < 1 ? `${Math.round(buffer * 24)} hours` : `${buffer.toFixed(1)} days`;
  return `Each ${windowDays}-day window also includes ${shown} before and after.`;
}
