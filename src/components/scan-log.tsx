"use client";

import { useEffect, useRef, useState } from "react";
import type { SectionId } from "@/lib/types";

type Snapshot = {
  running: boolean;
  section: SectionId | null;
  lines: string[];
  error: string | null;
};

export function useScanFeed(onDone: () => void) {
  const [feed, setFeed] = useState<Snapshot>({ running: false, section: null, lines: [], error: null });
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const source = new EventSource("/api/scan/events");
    source.addEventListener("snapshot", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as Snapshot;
      setFeed({ running: data.running, section: data.section, lines: data.lines, error: data.error });
    });
    source.addEventListener("log", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { line: string };
      setFeed((current) => ({ ...current, lines: [...current.lines, data.line].slice(-400) }));
    });
    source.addEventListener("done", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { error: string | null; running?: boolean };
      setFeed((current) => ({ ...current, running: false, error: data.error }));
      onDoneRef.current();
    });
    return () => source.close();
  }, []);

  return feed;
}

export function ScanLog({ lines, running }: { lines: string[]; running: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);
  if (!running && lines.length === 0) return null;
  return (
    <pre
      ref={ref}
      className="max-h-56 overflow-auto rounded-xl bg-black/40 p-3 font-mono text-xs leading-5 text-foreground/90"
    >
      {lines.length === 0 ? "Waiting for vdf-cli…" : lines.join("\n")}
    </pre>
  );
}
