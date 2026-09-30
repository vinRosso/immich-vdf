"use client";

import { useEffect, useState } from "react";
import { HardDrive } from "lucide-react";
import { cn } from "cn";
import { api } from "@/components/api";
import { AppShell } from "@/components/app-shell";
import { posterSrc } from "@/components/group-result-card";
import { ImmichIcon } from "@/components/icons/immich-icon";
import { HomeGroupGridSkeleton, ThumbnailSkeleton } from "@/components/skeletons";
import { formatClock, formatScanDuration } from "@/lib/format";
import { DEFAULT_RESULTS_GROUP_SORT, isResultsGroupSortId, resultsSortStorageKey } from "@/lib/results-sort";
import { sectionLabel } from "@/lib/section-label";
import { useClientMounted } from "@/lib/use-client-mounted";
import type { ResultsPreviewGroup, ResultsPreviewResponse, SectionId } from "@/lib/types";

const PREVIEW_COLS = 5;
const PREVIEW_ROWS = 2;
const PREVIEW_SLOTS = PREVIEW_COLS * PREVIEW_ROWS;

function previewSort(section: SectionId) {
  const stored = sessionStorage.getItem(resultsSortStorageKey(section));
  return stored && isResultsGroupSortId(stored) ? stored : DEFAULT_RESULTS_GROUP_SORT;
}

export function HomeScreen() {
  const mounted = useClientMounted();
  const [server, setServer] = useState<ResultsPreviewResponse | null>(null);
  const [immich, setImmich] = useState<ResultsPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const serverSort = previewSort("server");
    const immichSort = previewSort("immich");
    Promise.all([
      api<ResultsPreviewResponse>(`/api/results?section=server&preview=1&sort=${serverSort}&limit=${PREVIEW_SLOTS}`),
      api<ResultsPreviewResponse>(`/api/results?section=immich&preview=1&sort=${immichSort}&limit=${PREVIEW_SLOTS}`),
    ])
      .then(([nextServer, nextImmich]) => {
        if (cancelled) return;
        setServer(nextServer);
        setImmich(nextImmich);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load groups");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        {error ? <p className="mb-3 shrink-0 text-center text-sm text-destructive">{error}</p> : null}
        <div className="mx-auto grid w-full max-w-4xl flex-1 content-center gap-8 md:grid-cols-2 md:gap-10">
          {mounted ? (
            <>
              <SectionHub section="immich" href="/immich" results={immich} />
              <SectionHub section="server" href="/server" results={server} />
            </>
          ) : (
            <>
              <HomeHubPlaceholder section="immich" />
              <HomeHubPlaceholder section="server" />
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function HomeHubPlaceholder({ section }: { section: SectionId }) {
  const title = sectionLabel(section);
  return (
    <section className="flex flex-col items-stretch" aria-hidden>
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-5 rounded-3xl",
          "border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-10 md:p-12",
        )}
      >
        {section === "immich" ? (
          <ImmichIcon className="size-20 md:size-[5.5rem]" />
        ) : (
          <HardDrive className="size-20 text-primary md:size-[5.5rem]" strokeWidth={1.15} />
        )}
        <span className="font-heading text-4xl leading-none tracking-tight text-foreground/95">{title}</span>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground/90 tabular-nums">Loading last run…</p>
      <div className="mt-3.5 w-full">
        <HomeGroupGridSkeleton />
      </div>
    </section>
  );
}

function SectionHub({
  section,
  href,
  results,
}: {
  section: SectionId;
  href: string;
  results: ResultsPreviewResponse | null;
}) {
  const title = sectionLabel(section);
  const totalGroups = results?.groupCount ?? 0;
  const hasMore = totalGroups > PREVIEW_SLOTS;
  const previewCount = hasMore ? PREVIEW_SLOTS - 1 : Math.min(totalGroups, PREVIEW_SLOTS);
  const groups = results?.groups.slice(0, previewCount) ?? [];

  return (
    <section className="flex flex-col items-stretch">
      <a
        href={href}
        className={cn(
          "group relative flex flex-col items-center justify-center gap-5 overflow-hidden rounded-3xl",
          "border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-10 md:p-12",
          "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)] backdrop-blur-sm",
          "transition-all duration-300 hover:-translate-y-1 hover:border-primary/45 hover:shadow-[0_16px_48px_-12px_rgba(168,85,247,0.22)]",
          "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        )}
      >
        <div className="pointer-events-none absolute -top-16 left-1/2 size-44 -translate-x-1/2 rounded-full bg-primary/10 opacity-20 blur-2xl transition-opacity duration-500 group-hover:opacity-75" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <div className="relative transition-transform duration-300 group-hover:scale-105">
          {section === "immich" ? (
            <ImmichIcon className="size-20 md:size-[5.5rem]" />
          ) : (
            <HardDrive className="size-20 text-primary md:size-[5.5rem]" strokeWidth={1.15} aria-hidden />
          )}
        </div>
        <span className="font-heading text-4xl leading-none tracking-tight text-foreground/95 transition-colors group-hover:text-foreground">
          {title}
        </span>
      </a>

      <p className="mt-4 text-center text-xs text-muted-foreground/90 tabular-nums">
        <LastRunSummary results={results} />
      </p>

      <div className="mt-3.5 w-full">
        {!results ? <HomeGroupGridSkeleton /> : null}
        {results && !results.scanned ? (
          <div className="flex aspect-[5/2] w-full flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] p-3 text-center">
            <p className="text-sm font-medium text-foreground/80">No scan yet</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Open {title} to run your first scan</p>
          </div>
        ) : null}
        {results?.scanned && totalGroups === 0 ? (
          <div className="flex aspect-[5/2] w-full flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] p-3 text-center">
            <p className="text-sm font-medium text-foreground/80">Clean library</p>
            <p className="mt-0.5 text-xs text-muted-foreground">No duplicate groups in the latest scan</p>
          </div>
        ) : null}
        {results && groups.length > 0 ? (
          <div className="grid w-full grid-cols-5 gap-1.5">
            {groups.map((group) => (
              <HomeGroupThumb key={group.groupId} section={section} group={group} href={href} />
            ))}
            {hasMore ? <HomeMoreThumb href={href} extra={totalGroups - previewCount} /> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function HomeGroupThumb({ section, group, href }: { section: SectionId; group: ResultsPreviewGroup; href: string }) {
  const [ready, setReady] = useState(false);
  const label = `${group.itemCount} files${group.immichArchived ? ", Immich archived" : ""}`;

  return (
    <a
      href={href}
      className="relative block aspect-square w-full overflow-hidden rounded-lg bg-black/80 ring-1 ring-white/[0.08] shadow-sm transition-all duration-200 hover:scale-[1.04] hover:ring-primary/60 hover:shadow-[0_0_16px_rgba(168,85,247,0.3)]"
      aria-label={label}
      title={label}
    >
      <span className="absolute inset-0">
        {!ready ? <ThumbnailSkeleton /> : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src={posterSrc(section, { path: group.posterPath, assetId: group.posterAssetId })}
          onLoad={() => setReady(true)}
          onError={() => setReady(true)}
          className={cn(
            "size-full object-cover",
            ready ? "" : "opacity-0",
            group.immichArchived && "scale-110 blur-2xl",
          )}
        />
      </span>
      <span className="pointer-events-none absolute top-1 left-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white/90 shadow-sm backdrop-blur-xs">
        {group.itemCount}
      </span>
      {group.immichArchived ? (
        <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-black/80 px-1 py-0.5 text-[9px] font-medium tracking-wide text-white uppercase shadow-sm backdrop-blur-xs">
          Archived
        </span>
      ) : null}
    </a>
  );
}

function HomeMoreThumb({ href, extra }: { href: string; extra: number }) {
  return (
    <a
      href={href}
      className={cn(
        "flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-white/[0.14] bg-white/[0.02]",
        "text-4xl font-light leading-none text-muted-foreground transition-all duration-200 hover:scale-[1.04] hover:border-primary/50 hover:bg-primary/[0.06] hover:text-foreground",
      )}
      title={`${extra} more group${extra === 1 ? "" : "s"}`}
      aria-label={`View all groups, ${extra} more`}
    >
      +
    </a>
  );
}

function LastRunSummary({ results }: { results: ResultsPreviewResponse | null }) {
  if (!results) return <>Loading last run…</>;
  if (!results.scanned) return <>No scan yet</>;
  if (results.error) return <>Last run failed · {results.error}</>;
  const count = results.groupCount;
  const parts: string[] = [`${count} group${count === 1 ? "" : "s"}`];
  if (results.durationMs != null) {
    const dur = formatScanDuration(results.durationMs);
    if (dur) parts.push(dur);
  }
  if (results.hiddenIgnored > 0) parts.push(`${results.hiddenIgnored} ignored`);
  const stamp = formatClock(results.finishedAt);
  return (
    <>
      Last run{" "}
      <span className="font-semibold text-foreground">{stamp}</span>
      {parts.length > 0 ? <> · {parts.join(" · ")}</> : null}
    </>
  );
}
