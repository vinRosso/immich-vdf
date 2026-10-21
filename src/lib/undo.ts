import { randomUUID } from "node:crypto";
import type { StoredGroup } from "./types";

/** What it takes to take a Files trash back: the moved files, and the groups as they were. */
export type TrashUndo = {
  id: string;
  at: number;
  /** The scan the groups belong to. A newer scan makes the record useless. */
  finishedAt: string;
  moved: { mount: string; relative: string; original: string }[];
  groups: StoredGroup[];
};

export const UNDO_TTL_MS = 10 * 60 * 1000;
/** A bulk trash makes one record per group, so this has to be well above the group counts a library produces. */
const MAX_RECORDS = 500;

/** Kept on `globalThis` because each API route gets its own copy of this module. */
function store(): Map<string, TrashUndo> {
  const holder = globalThis as typeof globalThis & { __vdfTrashUndo?: Map<string, TrashUndo> };
  holder.__vdfTrashUndo ??= new Map();
  return holder.__vdfTrashUndo;
}

export function rememberTrashUndo(record: Omit<TrashUndo, "id" | "at">, now = Date.now()): string {
  const records = store();
  for (const [key, entry] of records) if (now - entry.at > UNDO_TTL_MS) records.delete(key);
  while (records.size >= MAX_RECORDS) {
    const oldest = records.keys().next().value;
    if (oldest === undefined) break;
    records.delete(oldest);
  }
  const id = randomUUID();
  records.set(id, { ...record, id, at: now });
  return id;
}

/** Returns the record and forgets it, or `null` when it is unknown or older than the time limit. */
export function takeTrashUndo(id: string, now = Date.now()): TrashUndo | null {
  const records = store();
  const record = records.get(id);
  if (!record) return null;
  records.delete(id);
  return now - record.at > UNDO_TTL_MS ? null : record;
}

/** Puts back a record that could not be used up, so the same Undo can be tried again. */
export function keepTrashUndo(record: TrashUndo): void {
  store().set(record.id, record);
}

/**
 * Puts restored groups back: a group still listed is replaced by its earlier version, others are added.
 * A file that was restored comes back at the path it now has (`restored` maps old to new). Any other file must still
 * exist (`alive`, when given), so a file trashed by a later action does not return as a ghost. A group left with fewer
 * than two files is not a group.
 */
export function restoreGroups(
  current: StoredGroup[],
  saved: StoredGroup[],
  restored: ReadonlyMap<string, string> = new Map(),
  alive: ReadonlySet<string> | null = null,
): StoredGroup[] {
  const byId = new Map<string, StoredGroup>();
  for (const group of saved) {
    const items = group.items.flatMap((item) => {
      const back = restored.get(item.path);
      if (back !== undefined) return [back === item.path ? item : { ...item, path: back }];
      return alive === null || alive.has(item.path) ? [item] : [];
    });
    if (items.length >= 2) byId.set(group.groupId, { ...group, items });
  }
  const next = current.map((group) => byId.get(group.groupId) ?? group);
  const present = new Set(current.map((group) => group.groupId));
  for (const [groupId, group] of byId) if (!present.has(groupId)) next.push(group);
  return next;
}
