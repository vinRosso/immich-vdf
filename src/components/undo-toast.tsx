"use client";

import { useEffect, useRef, useState } from "react";
import { UNDO_EVENT, publishResultsChanged, type UndoNotice } from "@/lib/undo-events";

const SHOW_MS = 8000;

/** Bottom-centre toast with an Undo link, shown for the notices that pages publish. */
export function UndoToast() {
  const [notice, setNotice] = useState<UndoNotice | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  function show(message: string, next: UndoNotice | null) {
    window.clearTimeout(timer.current);
    setNotice(next);
    setText(message);
    timer.current = window.setTimeout(() => setText(""), SHOW_MS);
  }

  useEffect(() => {
    function onNotice(event: Event) {
      const detail = (event as CustomEvent<UndoNotice>).detail;
      show(detail.message, detail);
    }
    window.addEventListener(UNDO_EVENT, onNotice);
    return () => {
      window.removeEventListener(UNDO_EVENT, onNotice);
      window.clearTimeout(timer.current);
    };
  }, []);

  async function undo() {
    if (!notice || busy) return;
    setBusy(true);
    try {
      await notice.undo();
      show("Undone", null);
    } catch (err) {
      show(err instanceof Error ? err.message : "Could not undo", null);
    } finally {
      setBusy(false);
      publishResultsChanged();
    }
  }

  if (!text) return null;
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-[80] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl bg-foreground py-2.5 pr-2.5 pl-4 text-sm font-medium text-background shadow-[0_10px_40px_-10px_rgba(0,0,0,0.7)]"
    >
      <span>{text}</span>
      {notice ? (
        <button type="button" disabled={busy} className="rounded-md px-2.5 py-1.5 font-bold underline disabled:opacity-60" onClick={() => void undo()}>
          Undo
        </button>
      ) : null}
    </div>
  );
}
