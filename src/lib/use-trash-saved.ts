"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { TRASH_SAVED_EVENT } from "@/lib/trash-events";

export type TrashSaved = {
  savedBytes: number;
  /** Files emptied out of `.vdf-trash`. */
  bytesFreed: number;
  immichBytesTrashed: number;
};

/** Space saved by trashed duplicates, kept fresh on focus and after a trash action. `saved` is `null` while loading; `failed` after a failed fetch with nothing to show. */
export function useTrashSaved(): { saved: TrashSaved | null; failed: boolean } {
  const [saved, setSaved] = useState<TrashSaved | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    function load() {
      api<Partial<TrashSaved>>("/api/trash?summary=1")
        .then((summary) => {
          setSaved({
            savedBytes: summary.savedBytes ?? 0,
            bytesFreed: summary.bytesFreed ?? 0,
            immichBytesTrashed: summary.immichBytesTrashed ?? 0,
          });
          setFailed(false);
        })
        .catch(() => setFailed(true));
    }
    load();
    window.addEventListener("focus", load);
    window.addEventListener(TRASH_SAVED_EVENT, load);
    return () => {
      window.removeEventListener("focus", load);
      window.removeEventListener(TRASH_SAVED_EVENT, load);
    };
  }, []);

  return { saved, failed };
}
