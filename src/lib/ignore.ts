import type { SectionId, StoredItem } from "./types";

export function ignoreKey(members: string[]): string {
  return [...members].map((member) => member.trim()).filter(Boolean).sort().join("\n");
}

export function memberIds(section: SectionId, items: StoredItem[]): string[] {
  if (section === "server") return items.map((item) => item.path);
  return items.map((item) => (item.assetId ? `asset:${item.assetId}` : `path:${item.path}`));
}
