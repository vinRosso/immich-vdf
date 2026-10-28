/** Small per-browser view choices (sort, card size). Storage can be blocked, so every access is allowed to fail. */

function read(store: () => Storage, key: string): string | null {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}

/** Reads from localStorage. A value an older version left in sessionStorage is copied over once. */
export function readViewPref(key: string): string | null {
  const stored = read(() => localStorage, key);
  if (stored !== null) return stored;
  const legacy = read(() => sessionStorage, key);
  if (legacy !== null) writeViewPref(key, legacy);
  return legacy;
}

export function writeViewPref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private window or blocked site data: the choice lasts until the page closes.
  }
}
