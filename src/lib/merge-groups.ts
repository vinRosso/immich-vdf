import { AppError } from "./errors";
import { orderGroupItems } from "./immich-stacks";
import { pickPrimaryIndex } from "./primary";
import type { ClientGroup, ClientItem, StoredGroup, StoredItem } from "./types";

function slash(value: string): string {
  return value.replace(/\\/g, "/");
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
    immichArchived: Boolean(better.immichArchived || other.immichArchived),
  };
}

function combineStoredItems(target: StoredItem[], source: StoredItem[]): StoredItem[] {
  const byPath = new Map<string, StoredItem>();
  for (const item of [...target, ...source]) {
    const key = slash(item.path);
    const existing = byPath.get(key);
    byPath.set(key, existing ? preferItem(existing, item) : item);
  }
  return orderGroupItems([...byPath.values()]);
}

/** Keep the target group's id and place. Drop the source group. */
export function mergeStoredGroups(groups: StoredGroup[], sourceGroupId: string, targetGroupId: string): StoredGroup[] {
  if (sourceGroupId === targetGroupId) throw new AppError("Drop the group on a different group");
  const source = groups.find((group) => group.groupId === sourceGroupId);
  const target = groups.find((group) => group.groupId === targetGroupId);
  if (!source || !target) throw new AppError("That group is not in the current results", 404);
  const items = combineStoredItems(target.items, source.items);
  if (items.length < 2) throw new AppError("Those groups do not have two different files");
  return groups.flatMap((group) => {
    if (group.groupId === sourceGroupId) return [];
    if (group.groupId === targetGroupId) return [{ groupId: target.groupId, items }];
    return [group];
  });
}

/** Move the chosen files into a new group. A remainder of one file is dropped from the results. */
export function extractStoredGroup(
  groups: StoredGroup[],
  groupId: string,
  paths: string[],
): { groups: StoredGroup[]; groupId: string } {
  const source = groups.find((group) => group.groupId === groupId);
  if (!source) throw new AppError("That group is not in the current results", 404);
  const wanted = new Set(paths.map(slash));
  const taken = source.items.filter((item) => wanted.has(slash(item.path)));
  if (taken.length < 2) throw new AppError("Select at least two files");
  if (taken.length >= source.items.length) throw new AppError("Leave at least one file in this group");
  const remain = source.items.filter((item) => !wanted.has(slash(item.path)));
  const nextId = `extract-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const created: StoredGroup = { groupId: nextId, items: orderGroupItems(taken) };
  return {
    groupId: nextId,
    groups: groups.flatMap((group) => {
      if (group.groupId !== groupId) return [group];
      if (remain.length < 2) return [created];
      return [{ groupId, items: orderGroupItems(remain) }, created];
    }),
  };
}

/** Same merge for the grid, so the card updates before the save finishes. */
export function mergeClientGroups(groups: ClientGroup[], sourceGroupId: string, targetGroupId: string): ClientGroup[] {
  if (sourceGroupId === targetGroupId) return groups;
  const source = groups.find((group) => group.groupId === sourceGroupId);
  const target = groups.find((group) => group.groupId === targetGroupId);
  if (!source || !target) return groups;
  const byPath = new Map<string, ClientItem>();
  for (const item of [...target.items, ...source.items]) {
    const key = slash(item.path);
    if (!byPath.has(key)) byPath.set(key, item);
  }
  const combined = orderGroupItems([...byPath.values()]) as ClientItem[];
  if (combined.length < 2) return groups;
  const primary = pickPrimaryIndex(combined);
  const items = combined.map((item, index) => ({ ...item, isPrimary: index === primary }));
  return groups.flatMap((group) => {
    if (group.groupId === sourceGroupId) return [];
    if (group.groupId === targetGroupId) return [{ groupId: target.groupId, items }];
    return [group];
  });
}
