import type { ClientGroup, SectionId, StoredGroup } from "./types";

export function groupHasImmichArchived(section: SectionId, group: ClientGroup | StoredGroup | null | undefined): boolean {
  if (section !== "immich" || !group) return false;
  return group.items.some((item) => Boolean(item.immichArchived));
}
