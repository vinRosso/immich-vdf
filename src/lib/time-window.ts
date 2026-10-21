import { bufferDays } from "./capture-window.mjs";

export { bufferDays };

export function timeWindowHint(windowDays: number): string {
  if (windowDays <= 0) return "No limit. Files from any date can match.";
  const buffer = bufferDays(windowDays);
  const shown = buffer < 1 ? `${Math.round(buffer * 24)} hours` : `${buffer.toFixed(1)} days`;
  return `Only files taken close together in time are compared: ${windowDays}-day windows, with ${shown} of overlap on each side.`;
}
