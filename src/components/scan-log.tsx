"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";
import { parseScanProgress } from "@/lib/scan-progress";
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
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (!running) {
      setStartedAt(null);
      return;
    }
    setStartedAt(Date.now());
    const id = window.setInterval(() => setTick(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [running]);

  if (!running) return null;

  const progress = parseScanProgress(lines);
  const elapsed =
    startedAt === null ? null : formatDuration(Math.max(0, (tick - startedAt) / 1000));

  return (
    <div className="space-y-2 rounded-xl bg-black/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-foreground">{progress.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {elapsed ? `Elapsed ${elapsed}` : "Elapsed —"}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted/80">
        {progress.indeterminate ? (
          <div className="relative h-full w-full overflow-hidden rounded-full bg-primary/25">
            <div className="absolute inset-y-0 w-1/3 animate-[scan-indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
          </div>
        ) : (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${progress.percent}%` }}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{progress.detail ?? "Waiting for vdf-cli…"}</span>
        <span className="tabular-nums">{progress.indeterminate ? "…" : `${progress.percent}%`}</span>
      </div>
    </div>
  );
}
