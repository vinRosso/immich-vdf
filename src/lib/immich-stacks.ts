import { originalPathToCli } from "./immich-join";
import type { ImmichStack } from "./immich";
import type { PathMapEntry, StoredGroup, StoredItem } from "./types";

function slash(value: string): string {
  return value.replace(/\\/g, "/");
}

export function itemStackId(item: StoredItem): string | null {
  return item.stackId ?? null;
}

export function blankStackItem(path: string, originalPath: string, assetId: string, stackId: string, stackPrimary: boolean): StoredItem {
  return {
    path,
    similarity: Number.NaN,
    sizeBytes: 0,
    durationSeconds: 0,
    resolution: null,
    width: 0,
    height: 0,
    bitrateKbps: 0,
    bitDepth: 0,
    audioBitrateKbps: 0,
    dateCreatedMs: 0,
    flags: [],
    partialClipOffsetSeconds: 0,
    isImage: true,
    format: null,
    fps: 0,
    assetId,
    originalPath,
    stackId,
    stackPrimary,
  };
}

/** Primary first inside each stack, stacks in first-seen order, then loose files. */
export function orderGroupItems(items: StoredItem[]): StoredItem[] {
  const blocks: StoredItem[][] = [];
  const indexByStack = new Map<string, number>();
  const loose: StoredItem[] = [];
  for (const item of items) {
    const stackId = itemStackId(item);
    if (!stackId) {
      loose.push(item);
      continue;
    }
    let index = indexByStack.get(stackId);
    if (index === undefined) {
      index = blocks.length;
      indexByStack.set(stackId, index);
      blocks.push([]);
    }
    blocks[index].push(item);
  }
  const ordered: StoredItem[] = [];
  for (const block of blocks) {
    block.sort((a, b) => Number(Boolean(b.stackPrimary)) - Number(Boolean(a.stackPrimary)) || slash(a.path).localeCompare(slash(b.path)));
    ordered.push(...block);
  }
  ordered.push(...loose);
  return ordered;
}

export function groupIsOneCompleteStack(group: StoredGroup): boolean {
  if (group.items.length < 2) return false;
  const stackIds = new Set<string>();
  for (const item of group.items) {
    if (!item.assetId || !itemStackId(item)) return false;
    stackIds.add(itemStackId(item)!);
    if (stackIds.size > 1) return false;
  }
  return stackIds.size === 1;
}

/** Drop groups Immich has already resolved. Partial stacks and mixed stacks stay visible. */
export function dropCompleteStacks(groups: StoredGroup[]): StoredGroup[] {
  return groups.filter((group) => group.items.length >= 2 && !groupIsOneCompleteStack(group));
}

/**
 * Copy stack id and primary from full Immich stacks, insert members the scan
 * did not group, then merge groups that share a file.
 */
/** Drop stack ids Immich no longer reports, then apply the stacks those assets belong to now. */
export function applyChangedStackMembership(
  groups: StoredGroup[],
  stacks: ImmichStack[],
  maps: PathMapEntry[],
  looseAssetIds: string[],
): StoredGroup[] {
  const loose = new Set(looseAssetIds);
  const cleared = groups.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.assetId && loose.has(item.assetId) ? { ...item, stackId: null, stackPrimary: false } : item,
    ),
  }));
  return applyStackMembership(cleared, stacks, maps);
}

export function applyStackMembership(groups: StoredGroup[], stacks: ImmichStack[], maps: PathMapEntry[]): StoredGroup[] {
  const byAsset = new Map<string, { stackId: string; primary: boolean; originalPath: string }>();
  for (const stack of stacks) {
    for (const asset of stack.assets) {
      byAsset.set(asset.id, {
        stackId: stack.id,
        primary: asset.id === stack.primaryAssetId,
        originalPath: asset.originalPath,
      });
    }
  }

  let current = groups.map((group) => ({
    ...group,
    items: group.items.map((item) => annotate(item, byAsset)),
  }));

  for (let pass = 0; pass < 8; pass += 1) {
    const expanded = current.map((group) => expandGroup(group, stacks, maps));
    const merged = mergeGroupsSharingPath(expanded);
    const before = current.map((group) => group.items.map((item) => slash(item.path)).sort().join("\n")).sort().join("\n\n");
    const after = merged.map((group) => group.items.map((item) => slash(item.path)).sort().join("\n")).sort().join("\n\n");
    current = merged.map((group) => ({
      ...group,
      items: group.items.map((item) => annotate(item, byAsset)),
    }));
    if (before === after) break;
  }

  return current.map((group) => ({ ...group, items: orderGroupItems(group.items) }));
}

function annotate(item: StoredItem, byAsset: Map<string, { stackId: string; primary: boolean; originalPath: string }>): StoredItem {
  if (!item.assetId) return { ...item, stackId: null, stackPrimary: false };
  const known = byAsset.get(item.assetId);
  if (!known) return { ...item, stackId: item.stackId ?? null, stackPrimary: Boolean(item.stackPrimary) };
  return {
    ...item,
    stackId: known.stackId,
    stackPrimary: known.primary,
    originalPath: item.originalPath ?? slash(known.originalPath),
  };
}

function expandGroup(group: StoredGroup, stacks: ImmichStack[], maps: PathMapEntry[]): StoredGroup {
  const present = new Set(group.items.map((item) => slash(item.path)));
  const assetIds = new Set(group.items.flatMap((item) => (item.assetId ? [item.assetId] : [])));
  const stackIds = new Set(group.items.flatMap((item) => (itemStackId(item) ? [itemStackId(item)!] : [])));
  const items = [...group.items];
  for (const stack of stacks) {
    if (!stackIds.has(stack.id) && !stack.assets.some((asset) => assetIds.has(asset.id))) continue;
    for (const asset of stack.assets) {
      if (assetIds.has(asset.id)) continue;
      const cli = originalPathToCli(asset.originalPath, maps);
      if (!cli) continue;
      const key = slash(cli);
      if (present.has(key)) continue;
      present.add(key);
      assetIds.add(asset.id);
      items.push(blankStackItem(cli, slash(asset.originalPath), asset.id, stack.id, asset.id === stack.primaryAssetId));
    }
  }
  return { ...group, items };
}

function mergeGroupsSharingPath(groups: StoredGroup[]): StoredGroup[] {
  const parent = groups.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) cursor = parent[cursor];
    parent[index] = cursor;
    return cursor;
  };
  const union = (a: number, b: number) => {
    const left = find(a);
    const right = find(b);
    if (left !== right) parent[right] = left;
  };
  const owner = new Map<string, number>();
  groups.forEach((group, index) => {
    for (const item of group.items) {
      const key = slash(item.path);
      const previous = owner.get(key);
      if (previous === undefined) owner.set(key, index);
      else union(previous, index);
      const stackId = itemStackId(item);
      if (!stackId) continue;
      const stackKey = `stack:${stackId}`;
      const stacked = owner.get(stackKey);
      if (stacked === undefined) owner.set(stackKey, index);
      else union(stacked, index);
    }
  });
  const buckets = new Map<number, StoredGroup[]>();
  groups.forEach((group, index) => {
    const root = find(index);
    const list = buckets.get(root) ?? [];
    list.push(group);
    buckets.set(root, list);
  });
  const merged: StoredGroup[] = [];
  for (const list of buckets.values()) {
    const [first, ...rest] = list;
    const byPath = new Map<string, StoredItem>();
    for (const group of [first, ...rest]) {
      for (const item of group.items) {
        const key = slash(item.path);
        const existing = byPath.get(key);
        byPath.set(key, existing ? preferItem(existing, item) : item);
      }
    }
    merged.push({ groupId: first.groupId, items: [...byPath.values()] });
  }
  return merged;
}

function preferItem(current: StoredItem, incoming: StoredItem): StoredItem {
  const currentScore = Number.isFinite(current.similarity) ? 2 : 0;
  const incomingScore = Number.isFinite(incoming.similarity) ? 2 : 0;
  const better = incomingScore > currentScore ? incoming : current;
  const other = better === incoming ? current : incoming;
  return {
    ...better,
    assetId: better.assetId ?? other.assetId,
    originalPath: better.originalPath ?? other.originalPath,
    stackId: better.stackId ?? other.stackId ?? null,
    stackPrimary: Boolean(better.stackPrimary || other.stackPrimary),
  };
}

/** Stack the selection in-place; peel them off prior stacks and unstack leftovers below two files. */
export function assignSelectionToStack(
  group: StoredGroup,
  selectedIds: string[],
  stackId: string,
  primaryAssetId: string,
): StoredGroup {
  const selected = new Set(selectedIds);
  const sourceStacks = new Set(
    group.items.flatMap((item) => (item.assetId && selected.has(item.assetId) && itemStackId(item) ? [itemStackId(item)!] : [])),
  );
  let items = group.items.map((item) => {
    if (!item.assetId || !selected.has(item.assetId)) return item;
    return { ...item, stackId, stackPrimary: item.assetId === primaryAssetId };
  });
  for (const sourceId of sourceStacks) {
    const remaining = items.filter((item) => itemStackId(item) === sourceId);
    if (remaining.length > 0 && remaining.length < 2) {
      items = items.map((item) =>
        itemStackId(item) === sourceId ? { ...item, stackId: null, stackPrimary: false } : item,
      );
    }
  }
  return { ...group, items: orderGroupItems(items) };
}

export function assignStack(group: StoredGroup, assetIds: string[], stackId: string, primaryAssetId: string): StoredGroup {
  const chosen = new Set(assetIds);
  const items = group.items.map((item) => {
    if (!item.assetId || !chosen.has(item.assetId)) return item;
    return { ...item, stackId, stackPrimary: item.assetId === primaryAssetId };
  });
  return { ...group, items: orderGroupItems(items) };
}

export function setStackPrimary(group: StoredGroup, stackId: string, assetId: string): StoredGroup {
  const items = group.items.map((item) =>
    itemStackId(item) === stackId ? { ...item, stackPrimary: item.assetId === assetId } : item,
  );
  return { ...group, items };
}

export function looseAssetIds(group: StoredGroup): string[] {
  return group.items.flatMap((item) => (item.assetId && !itemStackId(item) ? [item.assetId] : []));
}

export function stackIdsInGroup(group: StoredGroup): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of group.items) {
    const stackId = itemStackId(item);
    if (!stackId || seen.has(stackId)) continue;
    seen.add(stackId);
    ids.push(stackId);
  }
  return ids;
}

export function replaceGroup(groups: StoredGroup[], groupId: string, next: StoredGroup | null): StoredGroup[] {
  return groups.flatMap((group) => {
    if (group.groupId !== groupId) return [group];
    if (!next || next.items.length < 2) return [];
    return [next];
  });
}
