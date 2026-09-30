import { useSyncExternalStore } from "react";

/** True only in the browser after hydration. Server and the first client pass stay false. */
export function useClientMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
