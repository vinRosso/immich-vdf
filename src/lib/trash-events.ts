export const TRASH_SAVED_EVENT = "vdf:trash-saved";

/** Tells the saved-space card that the numbers changed. The card reads them again itself. */
export function publishTrashSaved(): void {
  window.dispatchEvent(new Event(TRASH_SAVED_EVENT));
}
