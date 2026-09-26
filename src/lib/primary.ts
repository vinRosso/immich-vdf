export function parseResolution(frame: string | null | undefined): { width: number; height: number } {
  if (!frame) return { width: 0, height: 0 };
  const match = /^(\d+)\s*x\s*(\d+)$/i.exec(frame.trim());
  if (!match) return { width: 0, height: 0 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function pickPrimaryIndex(
  items: { bitrateKbps: number; width: number; height: number; sizeBytes: number }[],
): number {
  let best = 0;
  for (let index = 1; index < items.length; index += 1) {
    const candidate = score(items[index]);
    const current = score(items[best]);
    for (let axis = 0; axis < candidate.length; axis += 1) {
      if (candidate[axis] === current[axis]) continue;
      if (candidate[axis] > current[axis]) best = index;
      break;
    }
  }
  return items.length === 0 ? -1 : best;
}

function score(item: { bitrateKbps: number; width: number; height: number; sizeBytes: number }): number[] {
  return [item.bitrateKbps, item.width * item.height, item.sizeBytes];
}
