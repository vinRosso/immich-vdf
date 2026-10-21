import { pickPrimaryIndex, type PrimaryPickItem } from "./primary";

/** Bytes a group frees when only its best file is kept. */
export function groupReclaimBytes(items: PrimaryPickItem[]): number {
  const best = pickPrimaryIndex(items);
  if (best < 0) return 0;
  return items.reduce((sum, item, index) => (index === best ? sum : sum + item.sizeBytes), 0);
}

export function totalReclaimBytes(groups: { items: PrimaryPickItem[] }[]): number {
  return groups.reduce((sum, group) => sum + groupReclaimBytes(group.items), 0);
}
