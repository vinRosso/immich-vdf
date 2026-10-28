"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/components/api";
import { AppShell } from "@/components/app-shell";
import { FolderPicker } from "@/components/folder-picker";
import { ScanSettingsSheet, scanSettingsSummary } from "@/components/scan-settings-sheet";
import { ScheduleSheet } from "@/components/schedule-sheet";
import { SpaceFreedCard } from "@/components/space-freed-card";
import { ScanLog, useScanFeed } from "@/components/scan-log";
import { ResultGroupCard } from "@/components/group-result-card";
import { useGroupMergeDrag } from "@/components/use-group-merge-drag";
import { ResultsGrid } from "@/components/results-grid";
import {
  GroupCardGridSkeleton,
  ImmichConnectionSkeleton,
  Reveal,
  SkeletonText,
} from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { Viewer } from "@/components/viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBytes, formatClock, formatCompactThousands, formatNextRun, formatScanDuration } from "@/lib/format";
import { totalReclaimBytes } from "@/lib/reclaim";
import { RESULTS_CHANGED_EVENT, publishUndo, undoIgnore, undoTrash } from "@/lib/undo-events";
import { sectionLabel } from "@/lib/section-label";
import { mergeClientGroups } from "@/lib/merge-groups";
import { readViewPref, writeViewPref } from "@/lib/view-prefs";
import { applyResultsPatch, type ResultsPatch } from "@/lib/results-patch";
import { pickPrimaryIndex, pickSmallestIndex } from "@/lib/primary";
import {
  DEFAULT_RESULTS_GROUP_SORT,
  RESULTS_GROUP_SORT_OPTIONS,
  isResultsGroupSortId,
  DEFAULT_RESULTS_CARD_SIZE,
  resultsCardSizeStorageKey,
  resultsSortStorageKey,
  sortResultGroups,
  type ResultsGroupSortId,
} from "@/lib/results-sort";
import { cn } from "cn";
import { CheckCircle2, ChevronRight, Clock, EyeOff, LayoutGrid, Loader2, SlidersHorizontal, Trash2, XCircle } from "lucide-react";
import type { RejoinProgress } from "@/lib/immich-rejoin-progress";
import { matchingDefaults, normalizeScan } from "@/lib/scan-defaults";
import { publishTrashSaved } from "@/lib/trash-events";
import type { ClientGroup, ClientItem, PublicSettings, ResultsResponse, RunsResponse, RuntimeInfo, ScanSettings, ScheduleSettings, SectionId, TrashEntry } from "@/lib/types";

type Draft = {
  scan: ScanSettings;
  schedule: ScheduleSettings;
  baseUrl: string;
  apiKey: string;
  clearApiKey: boolean;
  webhookUrl: string;
  clearWebhook: boolean;
};

const railCardClass =
  "rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.035] to-white/[0.01] p-3";

/** Small, quiet links to the ignored list and (Files only) the trash. */
function SectionQuietLinks({ section, ignoredCount, trashCount }: { section: SectionId; ignoredCount: number; trashCount: number }) {
  const linkClass = "inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground";
  return (
    <div className="flex items-center gap-4 px-1 pt-1 text-xs">
      <a href={`/ignored?section=${section}`} className={linkClass}>
        <EyeOff className="size-3.5 shrink-0" aria-hidden />
        {ignoredCount > 0 ? `${ignoredCount} Ignored` : "Ignored"}
      </a>
      {section === "server" ? (
        <a href="/trash" className={linkClass}>
          <Trash2 className="size-3.5 shrink-0" aria-hidden />
          {trashCount > 0 ? `${trashCount} Trashed` : "Trash"}
        </a>
      ) : null}
    </div>
  );
}

function RailButton({
  icon,
  title,
  subtitle,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-left transition-colors outline-none hover:border-primary/40 hover:bg-white/[0.04] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex size-[1.875rem] shrink-0 items-center justify-center rounded-lg bg-accent text-primary [&_svg]:size-4">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-medium">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{subtitle ?? "\u00a0"}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

export function SectionScreen({ section }: { section: SectionId }) {
  const router = useRouter();
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [runs, setRuns] = useState<RunsResponse | null>(null);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matchProgress, setMatchProgress] = useState<RejoinProgress | null>(null);

  /** Every request fills its own part of the page the moment it lands. The returned promise waits for all of them. */
  const reload = useCallback(async () => {
    const resultsRequest = api<ResultsResponse>(`/api/results?section=${section}`).then((next) => {
      setResults(next);
      return next;
    });
    const settingsRequest = api<PublicSettings>("/api/settings").then((nextSettings) => {
      setSettings(nextSettings);
      const saved = nextSettings[section];
      setDraft({
        scan: normalizeScan(saved.scan, section),
        schedule: saved.schedule,
        baseUrl: nextSettings.immich.baseUrl,
        apiKey: "",
        clearApiKey: false,
        webhookUrl: "",
        clearWebhook: false,
      });
    });
    const runtimeRequest = api<RuntimeInfo>("/api/runtime").then(setRuntime);
    const runsRequest = api<RunsResponse>("/api/runs").then(setRuns);
    const trashRequest =
      section === "server"
        ? api<{ entries: TrashEntry[] }>("/api/trash").then((listed) => setTrash(listed.entries))
        : Promise.resolve(setTrash([]));
    const settled = await Promise.allSettled([
      resultsRequest,
      settingsRequest,
      runtimeRequest,
      runsRequest,
      trashRequest,
    ]);
    const failed = settled.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    if (failed) throw failed.reason;
    return resultsRequest;
  }, [section]);

  /** Just the results, for after a viewer action. The full reload also refetches settings, runs and trash and resets the form. */
  const reloadResults = useCallback(async () => {
    const next = await api<ResultsResponse>(`/api/results?section=${section}`);
    setResults(next);
    // The Trash count in the header changes when a file is trashed. This does not hold up the list.
    if (section === "server") {
      void api<{ entries: TrashEntry[] }>("/api/trash")
        .then((listed) => setTrash(listed.entries))
        .catch(() => undefined);
    }
    return next;
  }, [section]);

  /** Applies what an action changed. Nothing is refetched, so the list keeps its place and the action ends sooner. */
  const applyPatch = useCallback(
    (patch: ResultsPatch) => {
      setResults((current) => (current ? applyResultsPatch(current, patch) : current));
      // The Trash count in the header changes when a file is trashed. This does not hold up the list.
      if (section === "server") {
        void api<{ entries: TrashEntry[] }>("/api/trash")
          .then((listed) => setTrash(listed.entries))
          .catch(() => undefined);
      }
    },
    [section],
  );

  const feed = useScanFeed(() => {
    void reload().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not refresh"));
  });

  useEffect(() => {
    let cancelled = false;
    reload().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this section");
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    if (section === "immich" && results && results.unmatched > 0) {
      router.prefetch("/immich/unmatched");
    }
  }, [section, results?.unmatched, router]);

  useEffect(() => {
    if (!matching) return;
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
  }, [matching]);

  async function matchAgain() {
    setMatching(true);
    setError(null);
    setNotice(null);
    setMatchProgress({
      running: true,
      percent: 0,
      label: "Starting",
      detail: "Getting started…",
      indeterminate: true,
    });
    try {
      const result = await api<{ matched: number; warning: string | null }>("/api/immich/rejoin", { method: "POST" });
      await reload();
      if (result.warning) setError(result.warning);
      else setNotice(`Matched ${result.matched} files to Immich assets.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not match files again");
    } finally {
      setMatching(false);
      setMatchProgress(null);
    }
  }

  function settingsUpdateBody() {
    if (!draft) return null;
    return section === "server"
      ? {
          server: { scan: draft.scan, schedule: draft.schedule },
          webhookUrl: draft.webhookUrl || undefined,
          clearWebhook: draft.clearWebhook,
        }
      : {
          immich: {
            baseUrl: draft.baseUrl,
            apiKey: draft.apiKey || undefined,
            clearApiKey: draft.clearApiKey,
            scan: draft.scan,
            schedule: draft.schedule,
          },
          webhookUrl: draft.webhookUrl || undefined,
          clearWebhook: draft.clearWebhook,
        };
  }

  async function persistDraft() {
    if (!draft || !settings) return;
    const body = settingsUpdateBody();
    if (!body) return;
    await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
    await reload();
  }

  async function save(patch?: Partial<Draft>) {
    if (!draft || !settings) return;
    const merged = patch ? { ...draft, ...patch } : draft;
    if (patch) setDraft(merged);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body =
        section === "server"
          ? {
              server: { scan: merged.scan, schedule: merged.schedule },
              webhookUrl: merged.webhookUrl || undefined,
              clearWebhook: merged.clearWebhook,
            }
          : {
              immich: {
                baseUrl: merged.baseUrl,
                apiKey: merged.apiKey || undefined,
                clearApiKey: merged.clearApiKey,
                scan: merged.scan,
                schedule: merged.schedule,
              },
              webhookUrl: merged.webhookUrl || undefined,
              clearWebhook: merged.clearWebhook,
            };
      await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
      await reload();
      setNotice("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    if (!draft) return;
    if (section === "server" && !draft.scan.includes.some((folder) => folder.trim())) {
      setError("Add at least one folder to scan");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await persistDraft();
      await api("/api/scan", { method: "POST", body: JSON.stringify({ section }) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the scan");
    } finally {
      setBusy(false);
    }
  }

  function resetMatchingDefaults() {
    if (!draft) return;
    setDraft({ ...draft, scan: { ...draft.scan, ...matchingDefaults(section, runtime?.suggestedParallelism) } });
  }

  const ignoredCount = results?.hiddenIgnored ?? 0;
  const reclaimBytes = useMemo(() => (results?.scanned ? totalReclaimBytes(results.groups) : 0), [results]);
  const runningHere = feed.running && feed.section === section;
  const last = runs?.[section].last;
  const scanLatestCaption =
    results?.finishedAt
      ? `Latest: ${formatClock(results.finishedAt)}${results.durationMs != null ? ` · ${formatScanDuration(results.durationMs)}` : ""}`
      : last?.at && last.status === "ok"
        ? `Latest: ${formatClock(last.at)}`
        : null;
  return (
    <AppShell wide>
      <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
        <div className="grid gap-3 lg:h-full lg:grid-cols-[18rem_minmax(0,1fr)] lg:pl-6">
          <aside
            aria-label={`${sectionLabel(section)} controls`}
            className="scrollbar-subtle flex min-h-0 flex-col gap-3.5 px-4 pt-5 pb-5 sm:px-6 lg:overflow-y-auto lg:px-0 lg:pr-0.5"
          >
            <h1 className="sr-only">{sectionLabel(section)}</h1>
            <Reveal className="flex flex-1 flex-col gap-3.5">
                {results?.scanned ? (
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {results.groups.length} {results.groups.length === 1 ? "group" : "groups"} ·{" "}
                    <b className="font-semibold text-primary">{formatBytes(reclaimBytes)}</b> can be freed
                  </p>
                ) : null}
                <div className="grid gap-1">
                  <Button
                    className="h-11 w-full min-w-[6.5rem] px-6 text-base"
                    title={runtime && !runtime.cliAvailable ? "Scanning isn't available right now" : undefined}
                    onClick={() => void scan()}
                    disabled={busy || matching || feed.running || !runtime?.cliAvailable || !draft}
                  >
                    {runningHere ? "Scanning" : "Scan"}
                  </Button>
                  {scanLatestCaption ? (
                    <p className="mt-1 text-center text-[11px] leading-snug text-muted-foreground/85">{scanLatestCaption}</p>
                  ) : null}
                  {feed.running ? (
                    <Button size="sm" variant="outline" onClick={() => void api("/api/scan/cancel", { method: "POST" })}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
                {matching && matchProgress ? <MatchProgress progress={matchProgress} /> : null}
                <ScanLog
                  lines={feed.section === section ? feed.lines : []}
                  running={runningHere}
                  startedAtMs={runningHere ? feed.startedAt : 0}
                />
                <div className="space-y-2">
                  <RailButton
                    icon={<SlidersHorizontal />}
                    title="Scan settings"
                    subtitle={draft ? scanSettingsSummary(draft.scan) : <SkeletonText className="mt-0.5 w-32" />}
                    disabled={!draft}
                    onClick={() => setSettingsOpen(true)}
                  />
                  <RailButton
                    icon={<Clock />}
                    title={draft && draft.schedule.mode !== "off" ? "Edit schedule" : "Schedule"}
                    subtitle={!runs ? <SkeletonText className="mt-0.5 w-28" /> : runs[section].nextRun ? `Next ${formatNextRun(runs[section].nextRun)}` : "Not scheduled"}
                    disabled={busy || !draft}
                    onClick={() => setScheduleDialogOpen(true)}
                  />
                </div>
                {section === "immich" && results && results.unmatched > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/35 bg-destructive/[0.12] px-3 py-2.5 text-xs">
                    <a
                      href="/immich/unmatched"
                      title="See the unmatched files"
                      className="min-w-[8.5rem] flex-1 hover:underline"
                    >
                      <b className="font-semibold text-[oklch(0.8_0.12_18)]">{results.unmatched} unmatched</b> files can&apos;t be stacked or trashed yet.
                    </a>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={busy || matching || feed.running || !settings?.immich.apiKeyConfigured}
                      onClick={() => void matchAgain()}
                    >
                      Match again
                    </Button>
                  </div>
                ) : null}
                {notice ? <p className="text-[11px] leading-snug text-primary">{notice}</p> : null}
                <SectionQuietLinks section={section} ignoredCount={ignoredCount} trashCount={trash.length} />
                <div className="mt-auto space-y-3 pt-2">
                  {section === "server" ? (
                    <div className={cn(railCardClass, "space-y-2.5")}>
                      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                        <span>Folders</span>
                      </div>
                      {draft ? (
                        <>
                          <FolderPicker
                            section={section}
                            label="Include"
                            dialogTitle="Include folders"
                            hint="Folders to scan, including their subfolders."
                            values={draft.scan.includes}
                            onChange={(includes) => setDraft({ ...draft, scan: { ...draft.scan, includes } })}
                          />
                          {draft.scan.includes.length === 0 ? (
                            <p className="text-xs text-destructive">Add at least one folder.</p>
                          ) : null}
                          <FolderPicker
                            section={section}
                            label="Exclude"
                            dialogTitle="Exclude folders"
                            hint="Folders to skip, including their subfolders."
                            values={draft.scan.excludes}
                            onChange={(excludes) => setDraft({ ...draft, scan: { ...draft.scan, excludes } })}
                            dashed
                          />
                        </>
                      ) : (
                        <div className="space-y-2.5" aria-busy="true" aria-label="Loading folders">
                          <Skeleton className="h-8 w-full rounded-lg" />
                          <Skeleton className="h-8 w-full rounded-lg" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={railCardClass}>
                      {draft ? (
                        <ImmichConnectionFields
                          draft={draft}
                          setDraft={setDraft}
                          settings={settings}
                          busy={busy}
                          onSave={persistDraft}
                          onReload={reload}
                        />
                      ) : (
                        <ImmichConnectionSkeleton />
                      )}
                    </div>
                  )}
                  <SpaceFreedCard />
                </div>
            </Reveal>
          </aside>
          <section
            aria-label="Duplicate groups"
            className="scrollbar-subtle min-h-0 px-4 pb-10 sm:px-6 lg:overflow-y-auto lg:pr-6 lg:pl-3.5"
          >
            {error ? <p className="pt-4 text-sm text-destructive">{error}</p> : null}
            {results ? (
              <Reveal index={1}>
                <Results
                  section={section}
                  results={results}
                  onReload={reload}
                  onReloadResults={reloadResults}
                  onApplyPatch={applyPatch}
                  matching={matching}
                  matchDisabled={busy || matching || feed.running || !settings?.immich.apiKeyConfigured}
                  onMatchAgain={() => void matchAgain()}
                />
              </Reveal>
            ) : (
            <Results
              section={section}
              results={results}
              onReload={reload}
              onReloadResults={reloadResults}
              onApplyPatch={applyPatch}
              matching={matching}
              matchDisabled={busy || matching || feed.running || !settings?.immich.apiKeyConfigured}
              onMatchAgain={() => void matchAgain()}
            />
            )}
          </section>
        </div>
      </div>
      {draft ? (
        <>
          <ScanSettingsSheet
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            section={section}
            scan={draft.scan}
            onChange={(scan) => setDraft({ ...draft, scan })}
            runtime={runtime}
            busy={busy}
            canScan={!matching && !feed.running && Boolean(runtime?.cliAvailable)}
            onReset={resetMatchingDefaults}
            onSave={() => {
              setSettingsOpen(false);
              void save();
            }}
            onSaveAndScan={() => {
              setSettingsOpen(false);
              void scan();
            }}
          />
          <ScheduleSheet
            open={scheduleDialogOpen}
            onOpenChange={setScheduleDialogOpen}
            section={section}
            draft={draft}
            settings={settings}
            runtime={runtime}
            busy={busy}
            hasActiveSchedule={draft.schedule.mode !== "off"}
            nextRunText={runs?.[section].nextRun ? formatNextRun(runs[section].nextRun) : null}
            onSave={(slice) => save(slice)}
          />
        </>
      ) : null}
    </AppShell>
  );
}

function MatchProgress({ progress }: { progress: RejoinProgress }) {
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

function Results({
  section,
  results,
  onReload,
  onReloadResults,
  onApplyPatch,
  matching,
  matchDisabled,
  onMatchAgain,
}: {
  section: SectionId;
  results: ResultsResponse | null;
  onReload: () => Promise<ResultsResponse>;
  onReloadResults: () => Promise<ResultsResponse>;
  onApplyPatch: (patch: ResultsPatch) => void;
  matching: boolean;
  matchDisabled: boolean;
  onMatchAgain: () => void;
}) {
  const [sortId, setSortId] = useState<ResultsGroupSortId>(DEFAULT_RESULTS_GROUP_SORT);
  const [cardSize, setCardSize] = useState(DEFAULT_RESULTS_CARD_SIZE);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<
    { kind: "stack"; keepSmallest: boolean; count: number } | { kind: "trash"; keepSmallest: boolean; count: number } | null
  >(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [groupOverride, setGroupOverride] = useState<ClientGroup[] | null>(null);

  // Saved after the first client render, so the server and the first client render agree. The grid waits for it.
  const [prefsReady, setPrefsReady] = useState(false);
  useEffect(() => {
    const stored = readViewPref(resultsSortStorageKey(section));
    if (stored && isResultsGroupSortId(stored)) setSortId(stored);
    const storedSize = readViewPref(resultsCardSizeStorageKey(section));
    if (storedSize) {
      const parsed = Number(storedSize);
      if (parsed >= 1 && parsed <= 9) setCardSize(parsed);
    }
    setPrefsReady(true);
  }, [section]);

  function changeSort(next: ResultsGroupSortId) {
    setSortId(next);
    writeViewPref(resultsSortStorageKey(section), next);
  }

  const listedGroups = groupOverride ?? results?.groups;
  const sortedGroups = useMemo(
    () => (listedGroups ? sortResultGroups(listedGroups, sortId) : []),
    [listedGroups, sortId],
  );

  const mergeDroppedGroup = useCallback(
    async (sourceGroupId: string, targetGroupId: string) => {
      const base = groupOverride ?? results?.groups;
      if (!base) return;
      setMergeError(null);
      setMergeBusy(true);
      setGroupOverride(mergeClientGroups(base, sourceGroupId, targetGroupId));
      setOpenGroupId((current) => (current === sourceGroupId ? targetGroupId : current));
      let merged: { patch?: ResultsPatch };
      try {
        merged = await api<{ patch?: ResultsPatch }>("/api/results/merge", {
          method: "POST",
          body: JSON.stringify({ section, sourceGroupId, targetGroupId }),
        });
      } catch (err) {
        setGroupOverride(null);
        setMergeError(err instanceof Error ? err.message : "Could not merge those groups");
        setMergeBusy(false);
        return;
      }
      try {
        if (merged.patch) onApplyPatch(merged.patch);
        else await onReloadResults();
      } catch (err) {
        setMergeError(err instanceof Error ? err.message : "Merged, but the list did not refresh");
      } finally {
        setMergeBusy(false);
      }
    },
    [groupOverride, onApplyPatch, onReloadResults, results?.groups, section],
  );

  const mergeDrag = useGroupMergeDrag({
    enabled: !bulkBusy && !mergeBusy,
    onMerge: (sourceGroupId, targetGroupId) => {
      void mergeDroppedGroup(sourceGroupId, targetGroupId);
    },
  });

  useEffect(() => {
    setGroupOverride(null);
  }, [results]);

  useEffect(() => {
    function refresh() {
      void onReloadResults().catch(() => undefined);
    }
    window.addEventListener(RESULTS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(RESULTS_CHANGED_EVENT, refresh);
  }, [onReloadResults]);
  const openIndex = openGroupId === null ? -1 : sortedGroups.findIndex((group) => group.groupId === openGroupId);
  const openGroup = openIndex >= 0 ? sortedGroups[openIndex] : null;

  async function openGroupAfterRefresh(fromIndex: number, groupId: string | null, patch?: ResultsPatch) {
    let data: ResultsResponse;
    if (patch && results) {
      data = applyResultsPatch(results, patch);
      onApplyPatch(patch);
    } else {
      data = await onReloadResults();
    }
    const groups = data.groups ? sortResultGroups(data.groups, sortId) : [];
    if (groupId && groups.some((entry) => entry.groupId === groupId)) {
      setOpenGroupId(groupId);
      return;
    }
    if (fromIndex < 0 || groups.length === 0) {
      setOpenGroupId(null);
      return;
    }
    const next = groups[fromIndex] ?? groups[fromIndex - 1];
    setOpenGroupId(next?.groupId ?? null);
  }

  async function ignoreGroup(groupId: string) {
    const fromIndex = openGroupId === groupId ? openIndex : -1;
    const ignored = await api<{ key?: string; patch?: ResultsPatch }>("/api/ignore", {
      method: "POST",
      body: JSON.stringify({ section, groupId }),
    });
    if (ignored.key) publishUndo({ message: "Group ignored", undo: undoIgnore(section, ignored.key) });
    await openGroupAfterRefresh(fromIndex, groupId, ignored.patch);
  }

  function requestStackAll(keepSmallest: boolean) {
    const targets = sortedGroups.filter((group) => !group.items.some((item) => item.stackId) && group.items.some((item) => item.assetId));
    if (targets.length === 0) {
      window.alert("All visible groups are already stacked.");
      return;
    }
    setBulkConfirm({ kind: "stack", keepSmallest, count: targets.length });
  }

  function requestTrashAll(keepSmallest: boolean) {
    if (sortedGroups.length === 0) return;
    setBulkConfirm({ kind: "trash", keepSmallest, count: sortedGroups.length });
  }

  async function runConfirmedBulk() {
    if (!bulkConfirm || bulkBusy) return;
    const { kind, keepSmallest } = bulkConfirm;
    setBulkConfirm(null);
    if (kind === "stack") await stackAllGroups(keepSmallest);
    else await trashAllGroups(keepSmallest);
  }

  function bulkKeep(group: ClientGroup, keepSmallest: boolean): ClientItem | undefined {
    const index = keepSmallest ? pickSmallestIndex(group.items) : pickPrimaryIndex(group.items);
    return group.items[index >= 0 ? index : 0];
  }

  function reportBulkFailures(verb: string, total: number, failed: { groupId: string; error: string }[]) {
    if (failed.length === 0) return;
    window.alert(`${failed.length} of ${total} groups could not be ${verb}: ${failed[0].error}`);
  }

  async function stackAllGroups(keepSmallest: boolean) {
    const targets = sortedGroups.filter((group) => !group.items.some((item) => item.stackId) && group.items.some((item) => item.assetId));
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      const groups = targets.flatMap((group) => {
        const primary = bulkKeep(group, keepSmallest);
        return primary?.assetId ? [{ groupId: group.groupId, primaryId: primary.assetId }] : [];
      });
      if (groups.length === 0) return;
      const outcome = await api<{ failed?: { groupId: string; error: string }[]; patch?: ResultsPatch }>("/api/immich/stack", {
        method: "POST",
        body: JSON.stringify({ groups }),
      });
      setOpenGroupId(null);
      if (outcome.patch) onApplyPatch(outcome.patch);
      else await onReload();
      reportBulkFailures("stacked", groups.length, outcome.failed ?? []);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not stack the groups");
      await onReload().catch(() => undefined);
    } finally {
      setBulkBusy(false);
    }
  }

  async function trashAllGroups(keepSmallest: boolean) {
    if (sortedGroups.length === 0) return;
    setBulkBusy(true);
    let undoCount = 0;
    let undoId: string | null = null;
    try {
      const groups = sortedGroups.flatMap((group): Record<string, string>[] => {
        const keep = bulkKeep(group, keepSmallest);
        if (!keep) return [];
        if (section === "server") return [{ groupId: group.groupId, keepPath: keep.path }];
        return keep.assetId ? [{ groupId: group.groupId, keepId: keep.assetId }] : [];
      });
      if (groups.length === 0) return;
      undoCount = groups.length;
      const outcome = await api<{ undoId?: string | null; failed?: { groupId: string; error: string }[]; patch?: ResultsPatch }>(
        section === "server" ? "/api/trash" : "/api/immich/trash",
        { method: "POST", body: JSON.stringify({ groups }) },
      );
      undoId = outcome.undoId ?? null;
      setOpenGroupId(null);
      if (outcome.patch) onApplyPatch(outcome.patch);
      else await onReload();
      publishTrashSaved();
      reportBulkFailures("trashed", groups.length, outcome.failed ?? []);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not trash the copies");
      await onReload().catch(() => undefined);
    } finally {
      if (undoId) publishUndo({ message: `Trashed copies from ${undoCount} groups`, undo: undoTrash([undoId]) });
      setBulkBusy(false);
    }
  }

  const loading = !results || !prefsReady;
  if (results && prefsReady && !results.scanned) {
    return (
      <Card className="border border-dashed border-border bg-transparent shadow-none ring-0">
        <CardHeader className="py-8">
          <CardTitle>No scan yet</CardTitle>
          <CardDescription className="max-w-prose text-sm leading-relaxed">
            {section === "server"
              ? "Add the folders to check, then run a scan. Nothing is removed until you choose to."
              : "Connect Immich, then run a scan. Nothing is removed until you choose to."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-20 flex flex-col gap-3 border-b border-white/[0.06] bg-background pt-4 pb-2.5 text-xs shadow-[0_0_0_100vmax_var(--background)] [clip-path:inset(0_-100vmax)] lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-4 lg:gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {results?.error ? <Badge variant="destructive">Failed</Badge> : null}
          {results?.warning ? <Badge variant="secondary">{results.warning}</Badge> : null}
          {mergeError ? <span className="text-destructive">{mergeError}</span> : null}
          <label className="flex items-center gap-1.5 text-muted-foreground">
            <span className="sr-only">Sort groups</span>
            {!prefsReady ? <Skeleton className="h-6 w-40 rounded-md" /> : null}
            <select
              hidden={!prefsReady}
              className="h-6 max-w-full truncate rounded-md border border-border bg-popover px-2 text-xs text-foreground [color-scheme:dark] sm:max-w-[14rem]"
              value={sortId}
              onChange={(event) => {
                const value = event.target.value;
                if (isResultsGroupSortId(value)) changeSort(value);
              }}
            >
              {RESULTS_GROUP_SORT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto sm:justify-end sm:gap-3 lg:gap-4">
          <label
            className="flex shrink-0 items-center gap-1 text-muted-foreground"
            title="Drag to make group cards larger or smaller"
          >
            <LayoutGrid className="size-3.5 shrink-0" aria-hidden />
            {!prefsReady ? <Skeleton className="h-1.5 w-14 sm:w-24" /> : null}
            <input
              hidden={!prefsReady}
              type="range"
              min={1}
              max={9}
              step={1}
              value={cardSize}
              aria-label="Card size"
              className="h-1.5 w-14 accent-primary sm:w-24"
              onChange={(event) => {
                const next = Number(event.target.value);
                setCardSize(next);
                writeViewPref(resultsCardSizeStorageKey(section), String(next));
              }}
            />
          </label>
          <div className="flex shrink-0 flex-nowrap items-center gap-1.5 border-l border-border pl-2 sm:gap-2 sm:pl-4">
            {section === "immich" ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button type="button" size="xs" disabled={matchDisabled} onClick={onMatchAgain}>
                    {matching ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        Matching…
                      </>
                    ) : (
                      "Match again"
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-sm whitespace-normal">
                  Refresh how these groups line up with Immich, without a new scan. Use it after changing stacks in Immich. New files still need a scan.
                </TooltipContent>
              </Tooltip>
            ) : null}
            {bulkBusy ? (
              <span className="flex items-center gap-1.5 text-muted-foreground" aria-live="polite">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {section === "immich" ? "Stacking…" : "Trashing…"}
              </span>
            ) : null}
            {section === "immich" ? (
              <>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={bulkBusy || sortedGroups.length === 0}
                  onClick={() => requestStackAll(false)}
                >
                  Stack best
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={bulkBusy || sortedGroups.length === 0}
                  onClick={() => requestStackAll(true)}
                >
                  Stack smallest
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={bulkBusy || sortedGroups.length === 0}
                  onClick={() => requestTrashAll(false)}
                >
                  Keep best, trash rest
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={bulkBusy || sortedGroups.length === 0}
                  onClick={() => requestTrashAll(true)}
                >
                  Keep smallest, trash rest
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
      {loading ? (
        <GroupCardGridSkeleton count={12} cardSize={cardSize} />
      ) : sortedGroups.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No groups to review</CardTitle>
            <CardDescription>Nothing to review right now. Ignored groups stay hidden until a new matching file turns up.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ResultsGrid
          items={sortedGroups}
          cardSize={cardSize}
          getKey={(group) => group.groupId}
          renderItem={(group) => (
            <ResultGroupCard
              section={section}
              group={group}
              dragging={mergeDrag.draggingId === group.groupId}
              dropTarget={mergeDrag.dropTargetId === group.groupId}
              dragBind={mergeDrag.bind(group.groupId)}
              onSelect={() => {
                if (mergeDrag.consumeSuppressedClick()) return;
                setOpenGroupId(group.groupId);
              }}
              topRight={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  className="bg-background/90 shadow-sm hover:bg-yellow-400 hover:text-yellow-950 dark:hover:bg-yellow-500 dark:hover:text-yellow-950"
                  aria-label="Ignore group"
                  title="Ignore group (hide from results)"
                  onClick={() => void ignoreGroup(group.groupId)}
                >
                  <EyeOff className="size-3.5" />
                </Button>
              }
            />
          )}
        />
      )}
      <Viewer
        section={section}
        group={openGroup}
        index={openIndex}
        total={sortedGroups.length}
        onPrev={() => {
          const previous = sortedGroups[openIndex - 1];
          if (previous) setOpenGroupId(previous.groupId);
        }}
        onNext={() => {
          const next = sortedGroups[openIndex + 1];
          if (next) setOpenGroupId(next.groupId);
        }}
        onClose={() => setOpenGroupId(null)}
        neighbors={openIndex >= 0 ? [sortedGroups[openIndex - 1], sortedGroups[openIndex + 1]] : []}
        onActionDone={(patch) => openGroupAfterRefresh(openIndex, openGroupId, patch)}
      />
      <Dialog open={bulkConfirm !== null} onOpenChange={(open) => !open && !bulkBusy && setBulkConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {bulkConfirm?.kind === "stack"
                ? bulkConfirm.keepSmallest
                  ? "Stack all with smallest on top?"
                  : "Stack all with best on top?"
                : bulkConfirm?.keepSmallest
                  ? "Keep smallest and trash the rest?"
                  : "Keep best and trash the rest?"}
            </DialogTitle>
            <DialogDescription>
              {bulkConfirm?.kind === "stack"
                ? `Stack ${bulkConfirm.count} groups that aren't stacked yet, with ${
                    bulkConfirm.keepSmallest ? "the smallest file" : "the best-quality file"
                  } on top.`
                : bulkConfirm
                  ? `Trash the extra copies in all ${bulkConfirm.count} groups and ${
                      bulkConfirm.keepSmallest
                        ? "keep the smallest file in each."
                        : "keep the best-quality file in each."
                    }${section === "server" ? " You can restore them from Trash." : ""}`
                  : null}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={bulkBusy} onClick={() => setBulkConfirm(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={bulkConfirm?.kind === "trash" ? "destructive" : "default"}
              disabled={bulkBusy || !bulkConfirm}
              onClick={() => void runConfirmedBulk()}
            >
              {bulkConfirm?.kind === "stack" ? "Stack" : "Trash"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type ImmichStatusResponse =
  | { connected: true; baseUrl: string; user: { email: string; name: string }; libraryTotal: number | null }
  | { connected: false; baseUrl?: string; error?: string };

function ImmichConnectionFields({
  draft,
  setDraft,
  settings,
  busy,
  onSave,
  onReload,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  settings: PublicSettings | null;
  busy: boolean;
  onSave: () => Promise<void>;
  onReload: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState<ImmichStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const credentialsSaved = Boolean(settings?.immich.apiKeyConfigured && settings.immich.baseUrl);
  const showForm = editing || !credentialsSaved;

  const refreshStatus = useCallback(() => {
    if (!credentialsSaved || editing) {
      setStatus(null);
      return;
    }
    setStatusLoading(true);
    void api<ImmichStatusResponse>("/api/immich/status")
      .then((body) => setStatus(body))
      .catch((err: unknown) => {
        setStatus({
          connected: false,
          baseUrl: settings?.immich.baseUrl,
          error: err instanceof Error ? err.message : "Could not check connection",
        });
      })
      .finally(() => setStatusLoading(false));
  }, [credentialsSaved, editing, settings?.immich.baseUrl]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  async function connect() {
    setFormError(null);
    const url = draft.baseUrl.trim();
    const key = draft.apiKey.trim();
    if (!url) {
      setFormError("Enter the Immich URL.");
      return;
    }
    if (!key && !settings?.immich.apiKeyConfigured) {
      setFormError("Paste an API key.");
      return;
    }
    setConnecting(true);
    try {
      await api("/api/immich/test", { method: "POST", body: JSON.stringify({ baseUrl: url, apiKey: key }) });
      await onSave();
      setEditing(false);
      await onReload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setFormError(null);
    setConnecting(true);
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ immich: { baseUrl: "", clearApiKey: true } }),
      });
      setDraft({ ...draft, baseUrl: "", apiKey: "", clearApiKey: false });
      setEditing(false);
      setStatus(null);
      await onReload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not disconnect");
    } finally {
      setConnecting(false);
    }
  }

  if (showForm) {
    return (
      <div className="min-w-0 space-y-2 text-xs text-muted-foreground">
        <div>Immich connection</div>
        <div className="grid w-full grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
          <Label htmlFor="base-url" className="text-xs text-muted-foreground justify-end">URL</Label>
          <Input
            id="base-url"
            className="h-[30px] w-full font-mono text-xs md:text-xs"
            value={draft.baseUrl}
            onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
            placeholder="http://immich:2283"
          />
          <Label htmlFor="api-key" className="text-xs text-muted-foreground justify-end">API key</Label>
          <Input
            id="api-key"
            className="h-[30px] w-full text-xs md:text-xs"
            type="password"
            value={draft.apiKey}
            placeholder={settings?.immich.apiKeyConfigured ? "Saved. Type to replace." : "Paste an API key"}
            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value, clearApiKey: false })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" size="xs" disabled={busy || connecting} onClick={() => void connect()}>
            {connecting ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                Connecting…
              </>
            ) : (
              "Connect"
            )}
          </Button>
          {credentialsSaved ? (
            <>
              <Button type="button" size="xs" variant="outline" disabled={connecting} onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <button
                type="button"
                disabled={busy || connecting}
                className="ml-auto text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                onClick={() => void disconnect()}
              >
                Disconnect
              </button>
            </>
          ) : null}
        </div>
        {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
      </div>
    );
  }

  const displayUrl = status?.connected ? status.baseUrl : settings?.immich.baseUrl ?? draft.baseUrl;
  const connected = status?.connected === true;
  const statusError = status?.connected === false ? status.error : null;

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Immich connection</span>
        <button
          type="button"
          disabled={busy || connecting}
          className="transition-colors hover:text-foreground disabled:opacity-50"
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      </div>
      {statusLoading ? (
        <ImmichConnectionSkeleton />
      ) : connected ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5 shrink-0 text-primary" aria-label="Connected" />
          <span className="truncate font-mono text-foreground/90">{displayUrl}</span>
          {status?.user ? (
            <>
              <span className="text-muted-foreground/60">·</span>
              <span className="text-foreground">{status.user.name}</span>
            </>
          ) : null}
          {status.libraryTotal != null ? (
            <>
              <span className="text-muted-foreground/60">·</span>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <span className="cursor-help tabular-nums text-foreground" tabIndex={0}>
                    {formatCompactThousands(status.libraryTotal)} assets
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">{status.libraryTotal.toLocaleString()} assets</TooltipContent>
              </Tooltip>
            </>
          ) : null}
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-destructive">
          <XCircle className="size-3.5 shrink-0" aria-hidden />
          {statusError ?? "Not connected"}
          <span className="text-muted-foreground/60">·</span>
          <span className="truncate font-mono text-foreground/90">{displayUrl}</span>
        </div>
      )}
      {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
    </div>
  );
}

