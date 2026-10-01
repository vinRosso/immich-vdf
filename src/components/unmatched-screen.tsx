"use client";

import { ArrowLeft, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/components/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UnmatchedScreenSkeleton } from "@/components/skeletons";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RejoinProgress } from "@/lib/immich-rejoin-progress";
import type { UnmatchedFile } from "@/lib/types";

type Report = {
  finishedAt: string | null;
  pathMap: { from: string; to: string }[];
  items: UnmatchedFile[];
};

/** Preview from the scanned file on the library mount — not the Immich asset API. */
function unmatchedPreviewSrc(item: UnmatchedFile): string {
  const encoded = encodeURIComponent(item.path);
  if (item.isImage) return `/api/media?section=immich&path=${encoded}`;
  return `/api/thumbs?section=immich&path=${encoded}&kind=poster`;
}

function parentFolder(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash > 0 ? normalized.slice(0, slash) : normalized;
}

function groupByFolder(items: UnmatchedFile[]): { folder: string; items: UnmatchedFile[] }[] {
  const byFolder = new Map<string, UnmatchedFile[]>();
  for (const item of items) {
    const folder = parentFolder(item.path);
    const list = byFolder.get(folder);
    if (list) list.push(item);
    else byFolder.set(folder, [item]);
  }
  return [...byFolder.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([folder, files]) => ({ folder, items: files }));
}

export function UnmatchedScreen() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [matchProgress, setMatchProgress] = useState<RejoinProgress | null>(null);

  async function load() {
    const next = await api<Report>("/api/immich/unmatched");
    setReport(next);
  }

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load unmatched files"));
  }, []);

  useEffect(() => {
    if (!busy) return;
    function poll() {
      void api<RejoinProgress>("/api/immich/rejoin/progress")
        .then((next) => {
          if (next.running) setMatchProgress(next);
        })
        .catch(() => {});
    }
    poll();
    const id = window.setInterval(poll, 250);
    return () => window.clearInterval(id);
  }, [busy]);

  const noMap = useMemo(() => groupByFolder(report?.items.filter((item) => item.reason === "no-map") ?? []), [report]);
  const noAsset = useMemo(() => groupByFolder(report?.items.filter((item) => item.reason === "no-asset") ?? []), [report]);

  async function rematch() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setMatchProgress({
      running: true,
      percent: 0,
      label: "Starting",
      detail: "Waiting for server…",
      indeterminate: true,
    });
    try {
      const result = await api<{ matched: number }>("/api/immich/rejoin", { method: "POST" });
      await load();
      setNotice(`Matched ${result.matched} files to Immich assets.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not match files again");
    } finally {
      setBusy(false);
      setMatchProgress(null);
    }
  }

  return (
    <AppShell>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="size-9 shrink-0 rounded-full">
          <a href="/immich" aria-label="Back to Immich results">
            <ArrowLeft className="size-5" />
          </a>
        </Button>
        <h1 className="font-heading text-4xl">Unmatched</h1>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        These files are in duplicate groups, but they are not linked to an Immich asset. Stack and trash skip them until the path map lines up with the path Immich stores.
      </p>
      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="mt-4 text-sm text-foreground">{notice}</p> : null}
      {!report ? <UnmatchedScreenSkeleton /> : null}
      {report ? (
        <div className="mt-6 space-y-8">
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-heading text-2xl">Path map</h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  Immich stores <span className="font-mono text-foreground">originalPath</span> under the left prefix. This app scans the folder on the right. A file matches when its scan path starts with a right-hand folder and the translated path is an Immich asset.
                </p>
              </div>
              <Button type="button" disabled={busy} onClick={() => void rematch()}>
                {busy ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Matching…
                  </>
                ) : (
                  "Match again"
                )}
              </Button>
            </div>
            {report.pathMap.length === 0 ? (
              <p className="text-sm text-muted-foreground">No path map yet. Connect Immich, then match again.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[36rem] text-left text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Immich path</th>
                      <th className="px-3 py-2 font-medium">Scan folder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.pathMap.map((entry) => (
                      <tr key={`${entry.from}\0${entry.to}`} className="border-t border-border">
                        <td className="px-3 py-2 font-mono break-all">{entry.from}</td>
                        <td className="px-3 py-2 font-mono break-all">{entry.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {busy && matchProgress ? <MatchProgressBar progress={matchProgress} /> : null}
          </section>
          {report.items.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Every file is matched</CardTitle>
                <CardDescription>This scan has no unmatched files in the visible groups.</CardDescription>
              </CardHeader>
            </Card>
          ) : null}
          <ReasonSection
            title="Outside the path map"
            hint="The scan path does not start with any scan folder above. Mount that folder so it sits under a mapped path, then match again."
            groups={noMap}
            showOriginal={false}
          />
          <ReasonSection
            title="Mapped, missing in Immich"
            hint="The scan path was translated, but no asset was linked. When two files would share a path, Immich keeps the uploaded name and stores the file as name+1.ext, then +2. Match again retries that lookup. If the Immich path itself differs from the one shown here, fix the path map first."
            groups={noAsset}
            showOriginal
          />
        </div>
      ) : null}
    </AppShell>
  );
}

function MatchProgressBar({ progress }: { progress: RejoinProgress }) {
  const percent = Math.min(100, Math.max(0, progress.percent));
  const indeterminate = Boolean(progress.indeterminate) || (progress.running && percent < 2);
  return (
    <div className="space-y-2 rounded-xl bg-black/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-foreground">{progress.label}</span>
        <span className="tabular-nums text-muted-foreground">{indeterminate ? "…" : `${percent}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted/80">
        {indeterminate ? (
          <div className="relative h-full w-full overflow-hidden rounded-full bg-primary/25">
            <div className="absolute inset-y-0 w-1/3 animate-[scan-indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
          </div>
        ) : (
          <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${percent}%` }} />
        )}
      </div>
      {progress.detail ? <p className="text-xs text-muted-foreground">{progress.detail}</p> : null}
    </div>
  );
}

function ReasonSection({
  title,
  hint,
  groups,
  showOriginal,
}: {
  title: string;
  hint: string;
  groups: { folder: string; items: UnmatchedFile[] }[];
  showOriginal: boolean;
}) {
  const count = groups.reduce((sum, group) => sum + group.items.length, 0);
  if (count === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-heading text-2xl">
          {title} <span className="text-muted-foreground">{count}</span>
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{hint}</p>
      </div>
      {groups.map((group) => (
        <FolderGroup key={group.folder} group={group} showOriginal={showOriginal} />
      ))}
    </section>
  );
}

function UnmatchedThumb({ item }: { item: UnmatchedFile }) {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  if (failed) {
    return <div className="size-14 shrink-0 rounded-md bg-muted" aria-hidden />;
  }
  return (
    <span className="relative block size-14 shrink-0">
      {!ready ? <Skeleton className="absolute inset-0 rounded-md" aria-hidden /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        src={unmatchedPreviewSrc(item)}
        loading="lazy"
        decoding="async"
        onLoad={() => setReady(true)}
        onError={() => setFailed(true)}
        className={ready ? "size-14 rounded-md bg-muted object-cover" : "size-14 rounded-md object-cover opacity-0"}
        title={item.name}
      />
    </span>
  );
}

function FolderGroup({
  group,
  showOriginal,
}: {
  group: { folder: string; items: UnmatchedFile[] };
  showOriginal: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/40"
      >
        <ChevronRight
          className={`mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
        <span className="min-w-0 font-mono text-xs text-muted-foreground">
          <span className="break-all text-foreground/90">{group.folder}</span>
          <span className="text-muted-foreground"> · {group.items.length}</span>
        </span>
      </button>
      {open ? (
        <ul className="divide-y divide-border border-t border-border">
          {group.items.map((item) => (
            <li key={`${item.groupId}\0${item.path}`} className="flex gap-3 px-3 py-2 pl-8">
              <UnmatchedThumb item={item} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{item.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground" title={item.path}>
                  {item.path}
                </p>
                {showOriginal && item.originalPath ? (
                  <p className="truncate font-mono text-xs text-foreground/80" title={item.originalPath}>
                    Immich path: {item.originalPath}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
