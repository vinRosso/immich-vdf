import { runPool } from "./concurrency";
import { fetchImmichStack, type ImmichStack } from "./immich";
import { applyStackMembership, itemStackId } from "./immich-stacks";
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
