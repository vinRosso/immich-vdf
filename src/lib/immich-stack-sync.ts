import { runPool } from "./concurrency";
import { fetchImmichStack, listImmichStacks, type ImmichStack } from "./immich";
import { applyStackMembership, dropCompleteStacks, itemStackId, stacksTouchingGroups } from "./immich-stacks";
import type { PathMapEntry, StoredGroup } from "./types";

const cache = new Map<string, { at: number; stack: ImmichStack | null }>();
const ttlMs = 60_000;

export function forgetImmichStacks(ids: string[]): void {
  for (const id of ids) cache.delete(id);
}

export function rememberImmichStack(stack: ImmichStack): void {
  if (!stack.id) return;
  cache.set(stack.id, { at: Date.now(), stack });
}

export async function loadImmichStacks(
  baseUrl: string,
  apiKey: string,
  stackIds: string[],
  parallelism: number,
): Promise<ImmichStack[]> {
  const now = Date.now();
  const stacks: ImmichStack[] = [];
  const missing: string[] = [];
  for (const id of [...new Set(stackIds)]) {
    const hit = cache.get(id);
    if (hit && now - hit.at < ttlMs) {
      if (hit.stack) stacks.push(hit.stack);
      continue;
    }
    missing.push(id);
  }
  await runPool(missing, parallelism, async (id) => {
    let stack: ImmichStack | null = null;
    try {
      stack = await fetchImmichStack(baseUrl, apiKey, id);
    } catch {
      stack = null;
    }
    cache.set(id, { at: Date.now(), stack });
    if (stack) stacks.push(stack);
  });
  return stacks;
}

/** Mark assets that already belong to an Immich stack, then hide groups that are exactly one stack. */
export function applyListedStacks(groups: StoredGroup[], stacks: ImmichStack[], maps: PathMapEntry[]): StoredGroup[] {
  const touching = stacksTouchingGroups(groups, stacks);
  if (touching.length === 0) return dropCompleteStacks(groups);
  return dropCompleteStacks(applyStackMembership(groups, touching, maps));
}

export async function applyLibraryStacks(
  groups: StoredGroup[],
  baseUrl: string,
  apiKey: string,
  maps: PathMapEntry[],
): Promise<StoredGroup[]> {
  return applyListedStacks(groups, await listImmichStacks(baseUrl, apiKey), maps);
}

export async function expandImmichGroups(
  groups: StoredGroup[],
  baseUrl: string,
  apiKey: string,
  maps: PathMapEntry[],
  parallelism: number,
): Promise<StoredGroup[]> {
  const stackIds = groups.flatMap((group) => group.items.flatMap((item) => (itemStackId(item) ? [itemStackId(item)!] : [])));
  if (stackIds.length === 0) return groups;
  const stacks = await loadImmichStacks(baseUrl, apiKey, stackIds, parallelism);
  if (stacks.length === 0) return groups;
  return applyStackMembership(groups, stacks, maps);
}
