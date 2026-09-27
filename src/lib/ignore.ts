import type { IgnoredEntry, SectionId, StoredGroup, StoredItem } from "./types";

export function ignoreKey(members: string[]): string {
  return [...members].map((member) => member.trim()).filter(Boolean).sort().join("\n");
}

export function memberIds(section: SectionId, items: StoredItem[]): string[] {
  if (section === "server") return items.map((item) => item.path);
  return items.map((item) => (item.assetId ? `asset:${item.assetId}` : `path:${item.path}`));
}

export function currentIgnoreKeys(section: SectionId, groups: StoredGroup[]): Set<string> {
  return new Set(groups.map((group) => ignoreKey(memberIds(section, group.items))));
}

/** Drop ignores that no longer match a scan group (restored duplicate, trashed files, etc.). */
export function pruneIgnoredEntries(section: SectionId, entries: IgnoredEntry[], groups: StoredGroup[]): IgnoredEntry[] {
  const active = currentIgnoreKeys(section, groups);
  return entries.filter((entry) => active.has(entry.key));
}
