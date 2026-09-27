export type PrimaryPickItem = {
  bitrateKbps: number;
  bitDepth?: number;
  isImage?: boolean;
  width: number;
  height: number;
  sizeBytes: number;
  audioBitrateKbps?: number;
  dateCreatedMs?: number;
};

export function parseResolution(frame: string | null | undefined): { width: number; height: number } {
  if (!frame) return { width: 0, height: 0 };
  const match = /^(\d+)\s*x\s*(\d+)$/i.exec(frame.trim());
  if (!match) return { width: 0, height: 0 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** Best: resolution → video bitrate or image bit depth → smaller file → audio bitrate → oldest. */
export function pickPrimaryIndex(items: PrimaryPickItem[]): number {
  let best = 0;
  for (let index = 1; index < items.length; index += 1) {
    if (isBetterPrimary(items[index], items[best])) best = index;
  }
  return items.length === 0 ? -1 : best;
}

export function pickSmallestIndex(items: PrimaryPickItem[]): number {
  let smallest = 0;
  for (let index = 1; index < items.length; index += 1) {
    const candidate = smallestScore(items[index]);
    const current = smallestScore(items[smallest]);
    for (let axis = 0; axis < candidate.length; axis += 1) {
      if (candidate[axis] === current[axis]) continue;
      if (candidate[axis] < current[axis]) smallest = index;
      break;
    }
  }
  return items.length === 0 ? -1 : smallest;
}

function isBetterPrimary(a: PrimaryPickItem, b: PrimaryPickItem): boolean {
  for (const axis of primaryAxes()) {
    const av = axis.value(a);
    const bv = axis.value(b);
    if (av === bv) continue;
    return axis.higher ? av > bv : av < bv;
  }
  return false;
}

function primaryAxes(): { value: (item: PrimaryPickItem) => number; higher: boolean }[] {
  return [
    { value: (item) => item.width * item.height, higher: true },
    { value: (item) => (item.isImage ? item.bitDepth ?? 0 : item.bitrateKbps), higher: true },
    { value: (item) => item.sizeBytes, higher: false },
    { value: (item) => item.audioBitrateKbps ?? 0, higher: true },
    { value: (item) => item.dateCreatedMs ?? 0, higher: false },
  ];
}

function smallestScore(item: PrimaryPickItem): number[] {
  return [item.bitrateKbps, item.width * item.height, item.sizeBytes];
}
