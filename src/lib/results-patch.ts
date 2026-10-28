import type { ClientGroup, ResultsResponse } from "./types";

/** What an action changed in the results list: groups to replace or add, groups that are gone, and the counts. */
export type ResultsPatch = {
  removedIds: string[];
  groups: ClientGroup[];
  hiddenIgnored: number;
  unmatched: number;
};

/** The same patch applied on the server (to build it) and in the browser (to avoid reloading the whole list). */
export function applyResultsPatch(results: ResultsResponse, patch: ResultsPatch): ResultsResponse {
  const removed = new Set(patch.removedIds);
  const incoming = new Map(patch.groups.map((group) => [group.groupId, group]));
  const seen = new Set<string>();
  const groups: ClientGroup[] = [];
  for (const group of results.groups) {
    if (removed.has(group.groupId) && !incoming.has(group.groupId)) continue;
    const next = incoming.get(group.groupId);
    if (next) seen.add(group.groupId);
    groups.push(next ?? group);
  }
  for (const group of patch.groups) if (!seen.has(group.groupId)) groups.push(group);
  return { ...results, groups, hiddenIgnored: patch.hiddenIgnored, unmatched: patch.unmatched };
}
