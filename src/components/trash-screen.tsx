"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/components/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { baseName, formatBytes, mountMediaPath } from "@/lib/format";
import { publishTrashSavedBytes } from "@/lib/trash-events";
import type { TrashEntry } from "@/lib/types";

function trashKey(entry: TrashEntry): string {
  return `${entry.mount}\0${entry.relative}`;
}

type TrashSort = "latest" | "oldest" | "name" | "largest" | "smallest";

function sortTrash(entries: TrashEntry[], sort: TrashSort): TrashEntry[] {
  const next = [...entries];
  next.sort((a, b) => {
    if (sort === "oldest") return a.addedAtMs - b.addedAtMs;
    if (sort === "name") return baseName(a.relative).localeCompare(baseName(b.relative));
    if (sort === "largest") return b.sizeBytes - a.sizeBytes;
    if (sort === "smallest") return a.sizeBytes - b.sizeBytes;
    return b.addedAtMs - a.addedAtMs;
  });
  return next;
}

function trashThumbSrc(entry: TrashEntry): string {
  return `/api/trash/thumb?mount=${encodeURIComponent(entry.mount)}&relative=${encodeURIComponent(entry.relative)}`;
}

function trashFileSrc(entry: TrashEntry): string {
  return `/api/trash/file?mount=${encodeURIComponent(entry.mount)}&relative=${encodeURIComponent(entry.relative)}`;
}

function trashIsVideo(relative: string): boolean {
  return /\.(mp4|m4v|webm|mkv|mov|avi)$/i.test(relative);
}

export function TrashScreen() {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoringAll, setRestoringAll] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [totalBytes, setTotalBytes] = useState(0);
  const [sort, setSort] = useState<TrashSort>("latest");
  const [preview, setPreview] = useState<TrashEntry | null>(null);
  const sorted = useMemo(() => (entries ? sortTrash(entries, sort) : []), [entries, sort]);

  async function load() {
    const listed = await api<{ entries: TrashEntry[]; totalBytes: number }>("/api/trash");
    setEntries(listed.entries);
    setTotalBytes(listed.totalBytes);
  }

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load trash"));
  }, []);

  async function restore(entry: TrashEntry) {
    const key = trashKey(entry);
    setRestoringKey(key);
    setError(null);
    try {
      await api("/api/trash", {
        method: "PATCH",
        body: JSON.stringify({ mount: entry.mount, relative: entry.relative }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore file");
    } finally {
      setRestoringKey(null);
    }
  }

  async function restoreAll() {
    setRestoringAll(true);
    setError(null);
    try {
      await api("/api/trash", { method: "PATCH", body: JSON.stringify({ all: true }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore files");
    } finally {
      setRestoringAll(false);
    }
  }

  async function empty() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ totalSavedBytes: number }>("/api/trash", { method: "DELETE" });
      publishTrashSavedBytes(result.totalSavedBytes);
      setConfirming(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not empty trash");
    } finally {
      setBusy(false);
    }
  }

  const hasFiles = Boolean(entries && entries.length > 0);

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/server"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Back to Server results"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <h1 className="font-heading text-4xl">Trash</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {hasFiles ? (
              <span className="font-heading text-2xl tabular-nums">
                {entries!.length} file{entries!.length === 1 ? "" : "s"} · {formatBytes(totalBytes)}
              </span>
            ) : null}
            {confirming ? (
              <>
                <span className="text-base text-muted-foreground">Delete everything permanently?</span>
                <Button variant="destructive" className="h-10 px-4 text-base" disabled={busy} onClick={() => void empty()}>Delete</Button>
                <Button variant="outline" className="h-10 px-4 text-base" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
              </>
            ) : (
              <Button
                variant="destructive"
                className="h-10 px-4 text-base"
                disabled={!hasFiles || busy || restoringAll}
                onClick={() => setConfirming(true)}
              >
                Empty trash
              </Button>
            )}
          </div>
        </div>
        <p className="mt-2 shrink-0 text-sm whitespace-nowrap text-muted-foreground">
          Files moved out of a Server scan land in .vdf-trash on the same mount. Emptying trash deletes them for good.
        </p>
        {error ? <p className="mt-2 shrink-0 text-sm text-destructive">{error}</p> : null}
        {!entries ? <p className="mt-4 text-sm text-muted-foreground">Loading…</p> : null}
        {entries && entries.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">Nothing is in .vdf-trash.</p> : null}
        {hasFiles ? (
          <>
            <div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Sort
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as TrashSort)}
                  className="h-9 rounded-lg border border-input bg-popover px-2 text-sm text-popover-foreground [color-scheme:dark]"
                >
                  <option value="latest">Latest added</option>
                  <option value="oldest">Oldest added</option>
                  <option value="name">Name</option>
                  <option value="largest">Largest</option>
                  <option value="smallest">Smallest</option>
                </select>
              </label>
              <Button type="button" variant="secondary" className="h-9 px-3" disabled={busy || restoringAll || Boolean(restoringKey)} onClick={() => void restoreAll()}>
                {restoringAll ? "Restoring…" : "Restore all"}
              </Button>
            </div>
            <ul className="mt-3 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                {sorted.map((entry) => {
                  const key = trashKey(entry);
                  const restoring = restoringKey === key;
                  return (
                    <li
                      key={key}
                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/20 px-2 py-2"
                    >
                      <button
                        type="button"
                        onClick={() => setPreview(entry)}
                        className="size-14 shrink-0 overflow-hidden rounded-md bg-muted ring-offset-background transition hover:ring-2 hover:ring-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Preview ${baseName(entry.relative)}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt="" src={trashThumbSrc(entry)} className="size-full object-contain" loading="lazy" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" title={mountMediaPath(entry.mount, entry.relative)}>
                          {baseName(entry.relative)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground" title={mountMediaPath(entry.mount, entry.relative)}>
                          {mountMediaPath(entry.mount, entry.relative)}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">{formatBytes(entry.sizeBytes)}</p>
                      </div>
                      <Button
                        type="button"
                        size="xs"
                        variant="secondary"
                        disabled={Boolean(restoringKey) || busy || restoringAll}
                        onClick={() => void restore(entry)}
                      >
                        {restoring ? "Restoring…" : "Restore"}
                      </Button>
                    </li>
                  );
                })}
            </ul>
          </>
        ) : null}
      </div>
      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="flex w-[min(92vw,40rem)] max-h-[min(88dvh,36rem)] flex-col gap-3 p-4 sm:max-w-[min(92vw,40rem)]">
          {preview ? (
            <>
              <DialogHeader>
                <DialogTitle className="truncate pr-8">{baseName(preview.relative)}</DialogTitle>
                <p className="truncate text-xs text-muted-foreground">{mountMediaPath(preview.mount, preview.relative)}</p>
              </DialogHeader>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {trashIsVideo(preview.relative) ? (
                  <video
                    src={trashFileSrc(preview)}
                    controls
                    playsInline
                    className="max-h-[min(72dvh,28rem)] w-full rounded-lg bg-black object-contain"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt=""
                    src={trashFileSrc(preview)}
                    className="mx-auto max-h-[min(72dvh,28rem)] w-full object-contain"
                  />
                )}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
