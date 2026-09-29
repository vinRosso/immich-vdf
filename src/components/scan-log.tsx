"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/components/api";
import { formatDuration } from "@/lib/format";
import { parseScanProgress } from "@/lib/scan-progress";
import type { SectionId } from "@/lib/types";

type Snapshot = {
  running: boolean;
  section: SectionId | null;
  lines: string[];
  error: string | null;
  startedAt: number;
};

function mergeStartedAt(next: number, running: boolean, prev: number): number {
  if (!running) return 0;
  if (next > 0) return next;
  return prev > 0 ? prev : 0;
}

function applyStatus(prev: Snapshot, data: Partial<Snapshot> & Pick<Snapshot, "running">): Snapshot {
  const running = data.running;
  const startedAt = mergeStartedAt(data.startedAt ?? 0, running, prev.startedAt);
  return {
    running,
    section: data.section !== undefined ? data.section : prev.section,
    lines: data.lines ?? prev.lines,
    error: data.error !== undefined ? data.error : prev.error,
    startedAt,
  };
}

export function useScanFeed(onDone: () => void) {
  const [feed, setFeed] = useState<Snapshot>({ running: false, section: null, lines: [], error: null, startedAt: 0 });
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    void api<Snapshot>("/api/scan/status")
      .then((data) => setFeed((prev) => applyStatus(prev, data)))
      .catch(() => undefined);

    const source = new EventSource("/api/scan/events");
    source.addEventListener("snapshot", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as Snapshot;
      setFeed((prev) => applyStatus(prev, data));
    });
    source.addEventListener("log", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { line: string; startedAt?: number };
      setFeed((current) =>
        applyStatus(current, {
          running: current.running,
          lines: [...current.lines, data.line].slice(-400),
          startedAt: data.startedAt ?? 0,
        }),
      );
    });
    source.addEventListener("done", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { error: string | null; running?: boolean };
      setFeed((current) => ({
        ...current,
        running: false,
        error: data.error,
        startedAt: 0,
      }));
      onDoneRef.current();
    });
    return () => source.close();
  }, []);

  return feed;
}

export function ScanLog({
  lines,
  running,
  startedAtMs,
}: {
  lines: string[];
  running: boolean;
  /** Wall-clock start from the server scan manager (survives page reload). */
  startedAtMs: number;
}) {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [running]);

  if (!running) return null;

  const progress = parseScanProgress(lines);
  const elapsedText =
    startedAtMs > 0 ? formatDuration(Math.max(0, (tick - startedAtMs) / 1000)) : null;

  return (
    <div className="space-y-2 rounded-xl bg-black/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-foreground">{progress.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {elapsedText ? `Elapsed ${elapsedText}` : "Elapsed —"}
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
