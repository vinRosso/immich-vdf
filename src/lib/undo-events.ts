import { api } from "@/components/api";
import { publishTrashSaved } from "./trash-events";
import type { SectionId } from "./types";

export const UNDO_EVENT = "vdf:undo";
export const RESULTS_CHANGED_EVENT = "vdf:results-changed";

export type UndoNotice = { message: string; undo: () => Promise<void> };

/** Shows a toast with an Undo link. `undo` runs when the link is clicked. */
export function publishUndo(notice: UndoNotice): void {
  window.dispatchEvent(new CustomEvent<UndoNotice>(UNDO_EVENT, { detail: notice }));
}

/** Tells the open page to reload its results, and the saved-space card to refresh. */
export function publishResultsChanged(): void {
  window.dispatchEvent(new Event(RESULTS_CHANGED_EVENT));
  publishTrashSaved();
}

export function undoIgnore(section: SectionId, key: string): () => Promise<void> {
  return async () => {
    await api("/api/ignore", { method: "DELETE", body: JSON.stringify({ section, key }) });
  };
}

export function undoTrash(ids: string[]): () => Promise<void> {
  return async () => {
    // One record that cannot be restored must not keep the others from being restored.
    let failure: unknown = null;
    for (const id of ids) {
      try {
        await api("/api/undo", { method: "POST", body: JSON.stringify({ id }) });
      } catch (err) {
        failure ??= err;
      }
    }
    if (failure) throw failure;
  };
}
