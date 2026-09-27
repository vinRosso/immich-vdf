export const TRASH_SAVED_EVENT = "vdf:trash-saved";

export function publishTrashSavedBytes(bytes: number): void {
  window.dispatchEvent(new CustomEvent<number>(TRASH_SAVED_EVENT, { detail: bytes }));
}
