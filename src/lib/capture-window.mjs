/** Same curve as engine/VDF.Core/TimeWindow.BufferDays. 0 means the whole library. */
export function bufferDays(windowDays) {
  if (!Number.isFinite(windowDays) || windowDays <= 0) return 0;
  return (windowDays / 3) * (90 / (90 + windowDays));
}

const EPOCH_MS = Date.UTC(2000, 0, 1);

/** Same rule as VDF.Core.TimeWindow.SharesWindow. `windowDays <= 0` is the whole library. */
export function sharesCaptureWindow(aMs, bMs, windowDays) {
  if (!Number.isFinite(windowDays) || windowDays <= 0) return true;
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return false;
  const buffer = bufferDays(windowDays);
  let first = (aMs - EPOCH_MS) / 86_400_000;
  let second = (bMs - EPOCH_MS) / 86_400_000;
  if (first > second) {
    const swap = first;
    first = second;
    second = swap;
  }
  if (second - first > windowDays + 2 * buffer + 1e-6) return false;
  const kMax = Math.floor((first + buffer) / windowDays);
  const kMin = Math.floor((first - windowDays - buffer) / windowDays);
  for (let k = kMin; k <= kMax; k += 1) {
    const start = k * windowDays - buffer;
    const end = (k + 1) * windowDays + buffer;
    if (first >= start && first <= end && second >= start && second <= end) return true;
  }
  return false;
}
