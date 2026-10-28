import { createHash } from "node:crypto";
import { orderGroupItems } from "./immich-stacks";
import { combineStoredItems } from "./merge-groups";
import type { GroupEdit, SectionId, StoredGroup, StoredItem } from "./types";

/** Keys an item can be recorded under: the member id, plus its path form for Immich items that gained an asset later. */
function itemKeys(section: SectionId, item: StoredItem): string[] {
  if (section === "server") return [item.path];
  return item.assetId ? [`asset:${item.assetId}`, `path:${item.path}`] : [`path:${item.path}`];
}

function matched(section: SectionId, group: StoredGroup, members: Set<string>): StoredItem[] {
  return group.items.filter((item) => itemKeys(section, item).some((key) => members.has(key)));
}

function extractId(members: string[]): string {
  return `extract-${createHash("sha1").update([...members].sort().join("\n")).digest("hex").slice(0, 12)}`;
}

function applyExtract(section: SectionId, groups: StoredGroup[], edit: GroupEdit): StoredGroup[] | null {
  const members = new Set(edit.members);
  const taken = groups.flatMap((group) => matched(section, group, members));
  if (taken.length < 2) return null;
  if (groups.some((group) => group.items.length === taken.length && matched(section, group, members).length === taken.length)) {
    return groups;
  }
  const out: StoredGroup[] = [];
  let inserted = false;
  for (const group of groups) {
    const hit = matched(section, group, members);
    if (hit.length === 0) {
      out.push(group);
      continue;
    }
    const remain = group.items.filter((item) => !hit.includes(item));
    if (remain.length >= 2) out.push({ groupId: group.groupId, items: remain });
    if (!inserted) {
      out.push({ groupId: extractId(edit.members), items: orderGroupItems(taken) });
      inserted = true;
    }
  }
  return out;
}

function applyMerge(section: SectionId, groups: StoredGroup[], edit: GroupEdit): StoredGroup[] | null {
  const members = new Set(edit.members);
  const hits = groups.filter((group) => matched(section, group, members).length > 0);
  const survivors = hits.reduce((sum, group) => sum + matched(section, group, members).length, 0);
  if (survivors < 2) return null;
  if (hits.length <= 1) return groups;
  const [first, ...rest] = hits;
  const items = rest.reduce((all, group) => combineStoredItems(all, group.items), first.items);
  return groups.flatMap((group) => {
    if (group === first) return [{ groupId: first.groupId, items }];
    return hits.includes(group) ? [] : [group];
  });
}

/**
 * Replays the user's extracts and merges on freshly scanned groups. Replaying the same edits twice changes nothing.
 * `edits` in the result are the ones that still match files; the rest are dropped.
 */
export function applyGroupEdits(
  section: SectionId,
  groups: StoredGroup[],
  edits: GroupEdit[],
): { groups: StoredGroup[]; edits: GroupEdit[] } {
  let current = groups;
  const kept: GroupEdit[] = [];
  for (const edit of [...edits].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const next = edit.type === "extract" ? applyExtract(section, current, edit) : applyMerge(section, current, edit);
    if (!next) continue;
    current = next;
    kept.push(edit);
  }
  return { groups: current, edits: kept };
}
