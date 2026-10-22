import { runPool } from "./concurrency";
import { fetchImmichStack, listImmichStacks, type ImmichStack } from "./immich";
import { applyStackMembership, dropCompleteStacks, itemStackId, releaseStacks, stacksTouchingGroups } from "./immich-stacks";
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

/** `gone` lists the ids Immich no longer has. A failed lookup is in neither list. */
export async function loadImmichStacks(
  baseUrl: string,
  apiKey: string,
  stackIds: string[],
  parallelism: number,
): Promise<{ stacks: ImmichStack[]; gone: string[] }> {
  const now = Date.now();
  const stacks: ImmichStack[] = [];
  const gone: string[] = [];
  const missing: string[] = [];
  for (const id of [...new Set(stackIds)]) {
    const hit = cache.get(id);
    if (hit && now - hit.at < ttlMs) {
      if (hit.stack) stacks.push(hit.stack);
      else gone.push(id);
      continue;
    }
    missing.push(id);
  }
  await runPool(missing, parallelism, async (id) => {
    let stack: ImmichStack | null;
    try {
      stack = await fetchImmichStack(baseUrl, apiKey, id);
    } catch {
      return;
    }
    cache.set(id, { at: Date.now(), stack });
    if (stack) stacks.push(stack);
    else gone.push(id);
  });
  return { stacks, gone };
}

function stackIdsInGroups(groups: StoredGroup[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const item of group.items) {
      const stackId = itemStackId(item);
      if (!stackId || seen.has(stackId)) continue;
      seen.add(stackId);
      ids.push(stackId);
    }
  }
  return ids;
}

/**
 * Annotate from Immich's stack list (search often omits membership), then fetch each
 * stack by id so every member is inserted — not only assets that happened to be in the
 * list payload or already present in the duplicate group.
 */
export async function syncGroupsWithImmichStacks(
  groups: StoredGroup[],
  baseUrl: string,
  apiKey: string,
  maps: PathMapEntry[],
  parallelism: number,
  listed: ImmichStack[] | null,
): Promise<StoredGroup[]> {
  const touching = listed ? stacksTouchingGroups(groups, listed) : [];
  // List payloads can be enough to stamp stack ids onto matched assets; member insertion
  // still goes through expandImmichGroups so GET /stacks/:id supplies the full set.
  const annotated = touching.length > 0 ? applyStackMembership(groups, touching, maps) : groups;
  const expanded = await expandImmichGroups(annotated, baseUrl, apiKey, maps, parallelism);
  return dropCompleteStacks(expanded);
}

/** List-only annotate/expand (no GET /stacks/:id). Prefer syncGroupsWithImmichStacks for scans. */
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
  parallelism: number,
  /** The stack list when the caller already started fetching it. */
  listed?: Promise<ImmichStack[]>,
): Promise<StoredGroup[]> {
  return syncGroupsWithImmichStacks(
    groups,
    baseUrl,
    apiKey,
    maps,
    parallelism,
    await (listed ?? listImmichStacks(baseUrl, apiKey)),
  );
}

export async function expandImmichGroups(
  groups: StoredGroup[],
  baseUrl: string,
  apiKey: string,
  maps: PathMapEntry[],
  parallelism: number,
): Promise<StoredGroup[]> {
  const stackIds = stackIdsInGroups(groups);
  if (stackIds.length === 0) return groups;
  // Drop cached list entries so a thin GET /stacks payload cannot block full members.
  forgetImmichStacks(stackIds);
  const { stacks, gone } = await loadImmichStacks(baseUrl, apiKey, stackIds, parallelism);
  // Immich deletes a stack once its other members are deleted, so a saved id can point at nothing.
  const released = releaseStacks(groups, gone);
  if (stacks.length === 0) return released;
  return applyStackMembership(released, stacks, maps);
}
