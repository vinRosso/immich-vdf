"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/components/api";
import { AppShell } from "@/components/app-shell";
import { FolderPicker, HintWrap } from "@/components/folder-picker";
import { ScanProfilePicker } from "@/components/scan-profile-picker";
import { TimezonePicker } from "@/components/timezone-picker";
import { ScanLog, useScanFeed } from "@/components/scan-log";
import { ResultGroupCard } from "@/components/group-result-card";
import { useGroupMergeDrag } from "@/components/use-group-merge-drag";
import { ResultsGrid } from "@/components/results-grid";
import {
  GroupCardGridSkeleton,
  ImmichConnectionSkeleton,
  ResultsToolbarSkeleton,
  SectionSettingsSkeleton,
} from "@/components/skeletons";
import { Viewer } from "@/components/viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBytes, formatClock, formatCompactThousands, formatLatestOkRun, formatNextRun, formatScanDuration } from "@/lib/format";
import { sectionLabel } from "@/lib/section-label";
import { timeWindowHint } from "@/lib/time-window";
import { mergeClientGroups } from "@/lib/merge-groups";
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
import { CheckCircle2, EyeOff, LayoutGrid, Loader2, RotateCcw, XCircle } from "lucide-react";
import { defaultScan, normalizeScan } from "@/lib/scan-defaults";
import { publishTrashSavedBytes } from "@/lib/trash-events";
import type { ClientGroup, PublicSettings, ResultsResponse, RunsResponse, RuntimeInfo, ScanSettings, ScheduleSettings, SectionId, TrashEntry } from "@/lib/types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Draft = {
  scan: ScanSettings;
  schedule: ScheduleSettings;
  baseUrl: string;
  apiKey: string;
  clearApiKey: boolean;
  webhookUrl: string;
  clearWebhook: boolean;
};

export function SectionScreen({ section }: { section: SectionId }) {
  const router = useRouter();
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [runs, setRuns] = useState<RunsResponse | null>(null);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);

  const reload = useCallback(async () => {
    const [nextRuntime, nextSettings, nextResults, nextRuns] = await Promise.all([
      api<RuntimeInfo>("/api/runtime"),
      api<PublicSettings>("/api/settings"),
      api<ResultsResponse>(`/api/results?section=${section}`),
      api<RunsResponse>("/api/runs"),
    ]);
    setRuntime(nextRuntime);
    setSettings(nextSettings);
    setResults(nextResults);
    setRuns(nextRuns);
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
    if (section === "server") {
      const listed = await api<{ entries: TrashEntry[] }>("/api/trash");
      setTrash(listed.entries);
    } else {
      setTrash([]);
    }
    return nextResults;
  }, [section]);

  const feed = useScanFeed(() => {
    void reload().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not refresh"));
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reload()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this section");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
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
    const defaults = defaultScan(section);
    setDraft({
      ...draft,
      scan: {
        ...draft.scan,
        threshold: defaults.threshold,
        percent: defaults.percent,
        parallelism: runtime?.suggestedParallelism ?? defaults.parallelism,
        includeImages: defaults.includeImages,
        usePhash: defaults.usePhash,
        partialClip: defaults.partialClip,
        aiMatching: defaults.aiMatching,
        aiPartial: defaults.aiPartial,
        compareHorizontallyFlipped: defaults.compareHorizontallyFlipped,
        ignoreBlackPixels: defaults.ignoreBlackPixels,
        ignoreWhitePixels: defaults.ignoreWhitePixels,
        timeWindowDays: defaults.timeWindowDays,
      },
    });
  }

  const runningHere = feed.running && feed.section === section;
  const last = runs?.[section].last;
  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-x-4 gap-y-2">
            <h1 className="font-heading text-4xl">{sectionLabel(section)}</h1>
            {draft ? (
              <ScanProfilePicker scan={draft.scan} onChange={(scan) => setDraft({ ...draft, scan })} />
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a href={`/ignored?section=${section}`} className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              Ignored
            </a>
            {section === "server" ? (
              <a href="/trash" className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                Trash{trash.length > 0 ? ` ${trash.length}` : ""}
              </a>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
            {draft ? (
              <>
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                    <div className="flex flex-wrap items-center gap-x-5">
                      <NumberField label="Threshold" hint="Hash difference from 0 to 10. Lower is stricter." value={draft.scan.threshold} onChange={(threshold) => setDraft({ ...draft, scan: { ...draft.scan, threshold } })} />
                      <NumberField label="Percent" hint="Minimum similarity to report as a duplicate." value={draft.scan.percent} onChange={(percent) => setDraft({ ...draft, scan: { ...draft.scan, percent } })} />
                      <NumberField
                        wide
                        label="Window"
                        hint={timeWindowHint(draft.scan.timeWindowDays)}
                        value={draft.scan.timeWindowDays}
                        onChange={(timeWindowDays) => setDraft({ ...draft, scan: { ...draft.scan, timeWindowDays } })}
                      />
                      <NumberField
                        label="Parallel"
                        hint={
                          runtime
                            ? `How many jobs run at once for hashing, probes, and thumbnails. This machine has ${runtime.cpuCount} cores. Suggested: ${runtime.suggestedParallelism}. Maximum: ${runtime.maxParallelism}.`
                            : "How many jobs run at once for hashing, probes, and thumbnails."
                        }
                        value={draft.scan.parallelism}
                        onChange={(parallelism) => setDraft({ ...draft, scan: { ...draft.scan, parallelism } })}
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                      <Flag label="Images" hint="Include image files as well as video." checked={draft.scan.includeImages} onChange={(includeImages) => setDraft({ ...draft, scan: { ...draft.scan, includeImages } })} />
                      <Flag label="pHash" hint="Perceptual hash instead of grayscale frame sampling." checked={draft.scan.usePhash} onChange={(usePhash) => setDraft({ ...draft, scan: { ...draft.scan, usePhash } })} />
                      <Flag
                        label="Mirrored"
                        hint="Also compare each pair against a horizontally flipped version to catch mirror re-uploads. Roughly doubles comparison work."
                        checked={draft.scan.compareHorizontallyFlipped}
                        onChange={(compareHorizontallyFlipped) => setDraft({ ...draft, scan: { ...draft.scan, compareHorizontallyFlipped } })}
                      />
                      <Flag label="Partial clips" hint="Find a clip inside a longer file using audio fingerprints." checked={draft.scan.partialClip} onChange={(partialClip) => setDraft({ ...draft, scan: { ...draft.scan, partialClip } })} />
                      <Flag label="AI match" hint="Neural embeddings for cropped, mirrored, or heavily edited copies. Downloads about 100 MB on first use." checked={draft.scan.aiMatching} onChange={(aiMatching) => setDraft({ ...draft, scan: { ...draft.scan, aiMatching } })} />
                      <Flag label="AI partial" hint="Visual partial matches without audio. Downloads the AI components on first use." checked={draft.scan.aiPartial} onChange={(aiPartial) => setDraft({ ...draft, scan: { ...draft.scan, aiPartial } })} />
                      <Button type="button" size="xs" variant="ghost" className="h-7 gap-1 text-muted-foreground" onClick={resetMatchingDefaults}>
                        <RotateCcw className="size-3" />
                        Reset defaults
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center py-2" aria-hidden>
                    <div className="h-px w-full bg-border" />
                  </div>
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    {section === "server" ? (
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <FolderPicker
                            section={section}
                            label="Include folders"
                            hint="Folders inside the mount to scan, including every subfolder."
                            values={draft.scan.includes}
                            onChange={(includes) => setDraft({ ...draft, scan: { ...draft.scan, includes } })}
                          />
                          {draft.scan.includes.length === 0 ? (
                            <p className="text-xs text-destructive">Add at least one folder.</p>
                          ) : null}
                        </div>
                        <FolderPicker
                          section={section}
                          label="Exclude folders"
                          hint="Folders to skip, including their subfolders."
                          values={draft.scan.excludes}
                          onChange={(excludes) => setDraft({ ...draft, scan: { ...draft.scan, excludes } })}
                        />
                      </div>
                    ) : (
                      <ImmichConnectionFields
                        draft={draft}
                        setDraft={setDraft}
                        settings={settings}
                        busy={busy}
                        onSave={persistDraft}
                        onReload={reload}
                      />
                    )}
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <p className="whitespace-nowrap text-[11px] leading-snug text-muted-foreground">
                            {runs?.[section].nextRun ? `Next ${formatNextRun(runs[section].nextRun)}` : "Not scheduled"}
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0"
                            onClick={() => setScheduleDialogOpen(true)}
                            disabled={busy}
                          >
                            {draft.schedule.mode === "off" ? "Add schedule" : "Edit schedule"}
                          </Button>
                        </div>
                        {notice ? <p className="text-right text-[11px] leading-snug text-primary">{notice}</p> : null}
                      </div>
                      <ScheduleSettingsDialog
                        open={scheduleDialogOpen}
                        onOpenChange={setScheduleDialogOpen}
                        section={section}
                        draft={draft}
                        settings={settings}
                        runtime={runtime}
                        busy={busy}
                        hasActiveSchedule={draft.schedule.mode !== "off"}
                        onSave={(slice) => save(slice)}
                      />
                      <div className="flex flex-col items-center gap-1">
                        <Button
                          className="h-11 min-w-[6.5rem] px-8 text-base"
                          title={runtime && !runtime.cliAvailable ? "vdf-cli is not installed on this machine" : undefined}
                          onClick={() => void scan()}
                          disabled={busy || feed.running || !runtime?.cliAvailable}
                        >
                          {runningHere ? "Scanning" : "Scan"}
                        </Button>
                        {last?.at && last.status === "ok" ? (
                          <p className="whitespace-nowrap text-center text-[10px] leading-snug text-muted-foreground/80">
                            {formatLatestOkRun(last.at)}
                          </p>
                        ) : null}
                        {feed.running ? (
                          <Button size="sm" variant="outline" onClick={() => void api("/api/scan/cancel", { method: "POST" })}>
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <SectionSettingsSkeleton />
            )}
        </div>
      <div className="space-y-4">
        <section className="space-y-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <ScanLog
            lines={feed.section === section ? feed.lines : []}
            running={runningHere}
            startedAtMs={runningHere ? feed.startedAt : 0}
          />
          <Results section={section} results={results} loading={loading} onReload={reload} />
        </section>
      </div>
      </div>
    </AppShell>
  );
}

function Results({
  section,
  results,
  loading,
  onReload,
}: {
  section: SectionId;
  results: ResultsResponse | null;
  loading: boolean;
  onReload: () => Promise<ResultsResponse>;
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

  useEffect(() => {
    const stored = sessionStorage.getItem(resultsSortStorageKey(section));
    if (stored && isResultsGroupSortId(stored)) setSortId(stored);
    const storedSize = sessionStorage.getItem(resultsCardSizeStorageKey(section));
    if (storedSize) {
      const parsed = Number(storedSize);
      if (parsed >= 1 && parsed <= 9) setCardSize(parsed);
    }
  }, [section]);

  function changeSort(next: ResultsGroupSortId) {
    setSortId(next);
    sessionStorage.setItem(resultsSortStorageKey(section), next);
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
      try {
        await api("/api/results/merge", {
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
        await onReload();
      } catch (err) {
        setMergeError(err instanceof Error ? err.message : "Merged, but the list did not refresh");
      } finally {
        setMergeBusy(false);
      }
    },
    [groupOverride, onReload, results?.groups, section],
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
  const openIndex = openGroupId === null ? -1 : sortedGroups.findIndex((group) => group.groupId === openGroupId);
  const openGroup = openIndex >= 0 ? sortedGroups[openIndex] : null;

  async function openGroupAfterRefresh(fromIndex: number, groupId: string | null) {
    const data = await onReload();
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
    await api("/api/ignore", { method: "POST", body: JSON.stringify({ section, groupId }) });
    await openGroupAfterRefresh(fromIndex, groupId);
  }

  function requestStackAll(keepSmallest: boolean) {
    const targets = sortedGroups.filter((group) => !group.items.some((item) => item.stackId) && group.items.some((item) => item.assetId));
    if (targets.length === 0) {
      window.alert("Every visible group already belongs to an Immich stack.");
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

  async function stackAllGroups(keepSmallest: boolean) {
    const targets = sortedGroups.filter((group) => !group.items.some((item) => item.stackId) && group.items.some((item) => item.assetId));
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      for (const group of targets) {
        const index = keepSmallest ? pickSmallestIndex(group.items) : pickPrimaryIndex(group.items);
        const primary = group.items[index >= 0 ? index : 0];
        if (!primary?.assetId) continue;
        await api("/api/immich/stack", {
          method: "POST",
          body: JSON.stringify({ groupId: group.groupId, primaryId: primary.assetId }),
        });
      }
      setOpenGroupId(null);
      await onReload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Bulk stack failed");
    } finally {
      setBulkBusy(false);
    }
  }

  async function trashAllGroups(keepSmallest: boolean) {
    if (sortedGroups.length === 0) return;
    setBulkBusy(true);
    try {
      for (const group of sortedGroups) {
        const index = keepSmallest ? pickSmallestIndex(group.items) : pickPrimaryIndex(group.items);
        const keep = group.items[index >= 0 ? index : 0];
        if (!keep) continue;
        if (section === "server") {
          await api("/api/trash", { method: "POST", body: JSON.stringify({ groupId: group.groupId, keepPath: keep.path }) });
        } else if (keep.assetId) {
          await api("/api/immich/trash", {
            method: "POST",
            body: JSON.stringify({ groupId: group.groupId, keepId: keep.assetId }),
          });
        }
      }
      setOpenGroupId(null);
      await onReload();
      const summary = await api<{ savedBytes: number }>("/api/trash?summary=1");
      publishTrashSavedBytes(summary.savedBytes);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Bulk trash failed");
    } finally {
      setBulkBusy(false);
    }
  }

  if (loading || !results) {
    return (
      <div className="space-y-3">
        <ResultsToolbarSkeleton />
        <GroupCardGridSkeleton count={12} cardSize={cardSize} />
      </div>
    );
  }
  if (!results.scanned) {
    return (
      <Card className="border border-dashed border-border bg-transparent shadow-none ring-0">
        <CardHeader className="py-8">
          <CardTitle>No scan yet</CardTitle>
          <CardDescription className="max-w-prose text-sm leading-relaxed">
            {section === "server"
              ? "Add folders inside the media mount and run a scan. Nothing is deleted until you trash it."
              : "Connect Immich, map original paths onto the read-only library mount, then scan."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {results.error ? <Badge variant="destructive">Failed</Badge> : null}
          {results.warning ? <Badge variant="secondary">{results.warning}</Badge> : null}
          {results.hiddenIgnored > 0 ? <Badge variant="outline">{results.hiddenIgnored} ignored</Badge> : null}
          {section === "immich" && results.unmatched > 0 ? (
            <Badge asChild variant="destructive" className="relative z-10 cursor-pointer hover:bg-destructive/80">
              <a href="/immich/unmatched" title="Open unmatched files and how to match them">
                {results.unmatched} unmatched
              </a>
            </Badge>
          ) : null}
          <span className="text-muted-foreground">
            {sortedGroups.length} {sortedGroups.length === 1 ? "group" : "groups"}
          </span>
          {mergeError ? <span className="text-destructive">{mergeError}</span> : null}
          <label className="flex items-center gap-1.5 text-muted-foreground">
            <span className="sr-only">Sort groups</span>
            <select
              className="h-6 max-w-[14rem] truncate rounded-md border border-border bg-popover px-2 text-xs text-foreground [color-scheme:dark]"
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
          <span className="text-muted-foreground">
            Finished {formatClock(results.finishedAt)}
            {results.durationMs != null ? ` · ${formatScanDuration(results.durationMs)}` : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-4">
          <label
            className="flex items-center gap-1.5 text-muted-foreground"
            title="Drag to make group cards larger or smaller"
          >
            <LayoutGrid className="size-3.5 shrink-0" aria-hidden />
            <span className="whitespace-nowrap">Card size</span>
            <input
              type="range"
              min={1}
              max={9}
              step={1}
              value={cardSize}
              aria-label="Card size"
              className="h-1.5 w-24 accent-primary"
              onChange={(event) => {
                const next = Number(event.target.value);
                setCardSize(next);
                sessionStorage.setItem(resultsCardSizeStorageKey(section), String(next));
              }}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 border-l border-border pl-4">
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
      {sortedGroups.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No groups to review</CardTitle>
            <CardDescription>This scan did not leave a visible duplicate group. Ignored groups stay hidden until a new file joins them.</CardDescription>
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
        onActionDone={() => openGroupAfterRefresh(openIndex, openGroupId)}
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
                ? `Create Immich stacks for ${bulkConfirm.count} groups that are not already stacked, using ${
                    bulkConfirm.keepSmallest ? "the smallest file" : "the best-quality file"
                  } as the stack primary.`
                : bulkConfirm
                  ? `Trash duplicates in all ${bulkConfirm.count} visible groups and ${
                      bulkConfirm.keepSmallest
                        ? "keep the smallest copy in each group."
                        : "keep the best-quality copy in each group."
                    }`
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
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="grid grid-cols-[5.75rem_12rem] items-center gap-x-2 gap-y-2">
            <Label htmlFor="base-url" className="text-right text-xs text-muted-foreground">Immich URL</Label>
            <Input
              id="base-url"
              className="h-8 w-full"
              value={draft.baseUrl}
              onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              placeholder="http://immich:2283"
            />
            <Label htmlFor="api-key" className="text-right text-xs text-muted-foreground">API key</Label>
            <Input
              id="api-key"
              className="h-8 w-full"
              type="password"
              value={draft.apiKey}
              placeholder={settings?.immich.apiKeyConfigured ? "Saved on the server. Enter a new key to replace it." : "Paste an API key"}
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value, clearApiKey: false })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={busy || connecting} onClick={() => void connect()}>
              {connecting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Connecting…
                </>
              ) : (
                "Connect"
              )}
            </Button>
            {credentialsSaved ? (
              <Button type="button" size="sm" variant="ghost" disabled={connecting} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
        {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
      </div>
    );
  }

  const displayUrl = status?.connected ? status.baseUrl : settings?.immich.baseUrl ?? draft.baseUrl;
  const connected = status?.connected === true;
  const statusError = status?.connected === false ? status.error : null;

  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      {statusLoading ? (
        <ImmichConnectionSkeleton />
      ) : connected ? (
        <div className="flex h-7 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0 text-xs text-muted-foreground">
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
        <div className="flex h-7 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0 text-xs text-destructive">
          <XCircle className="size-3.5 shrink-0" aria-hidden />
          {statusError ?? "Not connected"}
          <span className="text-muted-foreground/60">·</span>
          <span className="truncate font-mono text-foreground/90">{displayUrl}</span>
        </div>
      )}
      <div className="flex h-7 flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy || connecting} onClick={() => setEditing(true)}>
          Edit connection
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy || connecting} onClick={() => void disconnect()}>
          Disconnect
        </Button>
      </div>
      {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
    </div>
  );
}

function NumberField({ label, hint, value, onChange, wide }: { label: string; hint: string; value: number; onChange: (value: number) => void; wide?: boolean }) {
  return (
    <HintWrap text={hint} className="shrink-0">
      <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
        {label}
        <Input
          className={`h-7 ${wide ? "w-16" : "w-9"} border-0 bg-transparent px-0.5 text-sm font-semibold tabular-nums shadow-none underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground focus-visible:border-0 focus-visible:decoration-foreground focus-visible:ring-0 md:text-sm dark:bg-transparent`}
          type="text"
          inputMode="numeric"
          aria-label={label}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
      </label>
    </HintWrap>
  );
}

function Flag({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const row = (
    <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs">
      <span>{label}</span>
      <Switch size="sm" checked={checked} onCheckedChange={onChange} />
    </label>
  );
  if (!hint) return row;
  return <HintWrap text={hint}>{row}</HintWrap>;
}

type ScheduleDialogSlice = Pick<Draft, "schedule" | "webhookUrl"> & { scan: ScanSettings; webhookEdited: boolean };

function ScheduleSettingsDialog({
  open,
  onOpenChange,
  section,
  draft,
  settings,
  runtime,
  busy,
  hasActiveSchedule,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SectionId;
  draft: Draft;
  settings: PublicSettings | null;
  runtime: RuntimeInfo | null;
  busy: boolean;
  hasActiveSchedule: boolean;
  onSave: (slice: Pick<Draft, "schedule" | "webhookUrl" | "clearWebhook">) => Promise<void>;
}) {
  const [local, setLocal] = useState<ScheduleDialogSlice | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [webhookTesting, setWebhookTesting] = useState(false);
  const [webhookTestOk, setWebhookTestOk] = useState(false);
  const [webhookTestError, setWebhookTestError] = useState<string | null>(null);
  const [clock, setClock] = useState({ hour: "03", minute: "00" });
  const [timeError, setTimeError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDeleteConfirmOpen(false);
      setWebhookTestOk(false);
      setWebhookTestError(null);
      setTimeError(null);
      return;
    }
    const schedule: ScheduleSettings = {
      ...draft.schedule,
      mode: draft.schedule.mode === "off" ? "daily" : draft.schedule.mode,
    };
    setClock(scheduleTimeParts(schedule.time));
    setTimeError(null);
    setLocal({
      schedule,
      scan: structuredClone(draft.schedule.scan ?? draft.scan),
      webhookUrl: draft.webhookUrl,
      webhookEdited: false,
    });
  }, [open, draft]);

  function patchScan(patch: Partial<ScanSettings>) {
    setLocal((current) => (current ? { ...current, scan: { ...current.scan, ...patch } } : current));
  }

  function resetScheduleMatching() {
    const defaults = defaultScan(section);
    patchScan({
      threshold: defaults.threshold,
      percent: defaults.percent,
      parallelism: runtime?.suggestedParallelism ?? defaults.parallelism,
      includeImages: defaults.includeImages,
      usePhash: defaults.usePhash,
      partialClip: defaults.partialClip,
      aiMatching: defaults.aiMatching,
      aiPartial: defaults.aiPartial,
      compareHorizontallyFlipped: defaults.compareHorizontallyFlipped,
      ignoreBlackPixels: defaults.ignoreBlackPixels,
      ignoreWhitePixels: defaults.ignoreWhitePixels,
      timeWindowDays: defaults.timeWindowDays,
    });
  }

  async function apply() {
    if (!local) return;
    const time = normalizeScheduleClock(clock.hour, clock.minute);
    if (!time) {
      setTimeError("Enter an hour from 00 to 23 and a minute from 00 to 59.");
      return;
    }
    setTimeError(null);
    const mode = local.schedule.mode === "off" ? "daily" : local.schedule.mode;
    const webhookUrl = local.webhookUrl.trim();
    const clearWebhook =
      webhookUrl.length === 0 && local.webhookEdited && Boolean(settings?.webhookConfigured);
    await onSave({
      schedule: {
        ...local.schedule,
        mode,
        time,
        scan: { ...local.scan, includes: draft.scan.includes, excludes: draft.scan.excludes },
      },
      webhookUrl,
      clearWebhook,
    });
    onOpenChange(false);
  }

  async function testWebhook() {
    if (!local) return;
    const webhookUrl = local.webhookUrl.trim();
    if (!webhookUrl && !settings?.webhookConfigured) return;
    setWebhookTesting(true);
    setWebhookTestOk(false);
    setWebhookTestError(null);
    try {
      await api("/api/webhook/test", {
        method: "POST",
        body: JSON.stringify({
          section,
          webhookUrl: webhookUrl || undefined,
        }),
      });
      setWebhookTestOk(true);
    } catch (err) {
      setWebhookTestError(err instanceof Error ? err.message : "Webhook test failed");
    } finally {
      setWebhookTesting(false);
    }
  }

  async function confirmDeleteSchedule() {
    await onSave({
      schedule: { ...draft.schedule, mode: "off" },
      webhookUrl: "",
      clearWebhook: true,
    });
    setDeleteConfirmOpen(false);
    onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-max max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] justify-items-start overflow-y-auto sm:max-w-[calc(100%-2rem)]">
        <DialogHeader>
          <DialogTitle>Schedule</DialogTitle>
          <DialogDescription>
            Scheduled runs only start a scan. They never stack, trash, or delete.
            <br />
            These matching options are used by the schedule and stay separate from the controls on the page.
          </DialogDescription>
        </DialogHeader>
        {local ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <NumberField label="Threshold" hint="Hash difference from 0 to 10. Lower is stricter." value={local.scan.threshold} onChange={(threshold) => patchScan({ threshold })} />
                <NumberField label="Percent" hint="Minimum similarity to report as a duplicate." value={local.scan.percent} onChange={(percent) => patchScan({ percent })} />
                <NumberField wide label="Window" hint={timeWindowHint(local.scan.timeWindowDays)} value={local.scan.timeWindowDays} onChange={(timeWindowDays) => patchScan({ timeWindowDays })} />
                <NumberField
                  label="Parallel"
                  hint={
                    runtime
                      ? `How many jobs run at once for hashing, probes, and thumbnails. This machine has ${runtime.cpuCount} cores. Suggested: ${runtime.suggestedParallelism}. Maximum: ${runtime.maxParallelism}.`
                      : "How many jobs run at once for hashing, probes, and thumbnails."
                  }
                  value={local.scan.parallelism}
                  onChange={(parallelism) => patchScan({ parallelism })}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Flag label="Images" hint="Include image files as well as video." checked={local.scan.includeImages} onChange={(includeImages) => patchScan({ includeImages })} />
                <Flag label="pHash" hint="Perceptual hash instead of grayscale frame sampling." checked={local.scan.usePhash} onChange={(usePhash) => patchScan({ usePhash })} />
                <Flag
                  label="Mirrored"
                  hint="Also compare each pair against a horizontally flipped version to catch mirror re-uploads. Roughly doubles comparison work."
                  checked={local.scan.compareHorizontallyFlipped}
                  onChange={(compareHorizontallyFlipped) => patchScan({ compareHorizontallyFlipped })}
                />
                <Flag label="Partial clips" hint="Find a clip inside a longer file using audio fingerprints." checked={local.scan.partialClip} onChange={(partialClip) => patchScan({ partialClip })} />
                <Flag label="AI match" hint="Neural embeddings for cropped, mirrored, or heavily edited copies. Downloads about 100 MB on first use." checked={local.scan.aiMatching} onChange={(aiMatching) => patchScan({ aiMatching })} />
                <Flag label="AI partial" hint="Visual partial matches without audio. Downloads the AI components on first use." checked={local.scan.aiPartial} onChange={(aiPartial) => patchScan({ aiPartial })} />
                <Button type="button" size="xs" variant="ghost" className="h-7 gap-1 text-muted-foreground" onClick={resetScheduleMatching}>
                  <RotateCcw className="size-3" />
                  Reset defaults
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <ScheduleTimingRow
                schedule={local.schedule}
                hour={clock.hour}
                minute={clock.minute}
                timeError={timeError}
                onClockChange={(next) => {
                  setTimeError(null);
                  setClock(next);
                }}
                onChange={(schedule) => setLocal({ ...local, schedule: { ...schedule, scan: local.scan } })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-webhook">Finish webhook</Label>
              <p className="text-sm text-muted-foreground">A webhook fires when a scheduled scan finishes.</p>
              <div className="flex max-w-[min(28rem,calc(100vw-3rem))] items-center gap-2">
                <Input
                  id="schedule-webhook"
                  className="min-w-0 flex-1"
                  placeholder={settings?.webhookConfigured ? "Saved. Enter a new URL to replace it." : "https://example.test/hook"}
                  value={local.webhookUrl}
                  onChange={(event) => {
                    setWebhookTestOk(false);
                    setWebhookTestError(null);
                    setLocal({ ...local, webhookUrl: event.target.value, webhookEdited: true });
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0"
                  disabled={
                    busy ||
                    webhookTesting ||
                    (!local.webhookUrl.trim() && !settings?.webhookConfigured)
                  }
                  onClick={() => void testWebhook()}
                >
                  {webhookTesting ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Test
                    </>
                  ) : (
                    "Test"
                  )}
                </Button>
              </div>
              {webhookTestOk ? (
                <p className="text-xs text-muted-foreground">Webhook accepted the test request.</p>
              ) : null}
              {webhookTestError ? <p className="text-xs text-destructive">{webhookTestError}</p> : null}
            </div>
          </div>
        ) : null}
        <DialogFooter className="mx-0 mb-0 mt-4 w-full flex-row items-center justify-between gap-2 border-t-0 bg-transparent p-0 sm:justify-between">
          {hasActiveSchedule ? (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => setDeleteConfirmOpen(true)}
            >
              Delete schedule
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-row-reverse gap-2 sm:flex-row">
            <Button type="button" onClick={() => void apply()} disabled={busy || !local}>
              Save schedule
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteConfirmOpen} onOpenChange={(next) => !busy && setDeleteConfirmOpen(next)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete schedule?</DialogTitle>
            <DialogDescription>
              Scheduled scans for this section will stop and the saved finish webhook will be removed. Scan settings on the page are not changed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirmDeleteSchedule()}>
              Delete schedule
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ScheduleTimingRow({
  schedule,
  onChange,
  hour,
  minute,
  timeError,
  onClockChange,
}: {
  schedule: ScheduleSettings;
  onChange: (schedule: ScheduleSettings) => void;
  hour: string;
  minute: string;
  timeError: string | null;
  onClockChange: (clock: { hour: string; minute: string }) => void;
}) {
  const selectClass =
    "h-7 rounded-md border-0 bg-transparent px-0.5 text-sm font-semibold text-foreground underline decoration-muted-foreground/50 underline-offset-4 [color-scheme:dark] hover:decoration-foreground focus-visible:decoration-foreground focus-visible:outline-none";
  const timeFieldClass =
    "h-7 w-9 border-0 bg-transparent px-0.5 text-center text-sm font-semibold tabular-nums shadow-none underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground focus-visible:border-0 focus-visible:decoration-foreground focus-visible:ring-0 md:text-sm dark:bg-transparent";
  return (
    <div className="space-y-1">
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
        Frequency
        <select
          className={selectClass}
          aria-label="Frequency"
          value={schedule.mode === "off" ? "daily" : schedule.mode}
          onChange={(event) =>
            onChange({ ...schedule, mode: event.target.value as Exclude<ScheduleSettings["mode"], "off"> })
          }
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
        Time
        <Input
          className={timeFieldClass}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={2}
          aria-label="Hour"
          aria-invalid={Boolean(timeError)}
          value={hour}
          onChange={(event) => onClockChange({ hour: event.target.value, minute })}
        />
        <span className="text-sm text-muted-foreground">:</span>
        <Input
          className={timeFieldClass}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={2}
          aria-label="Minute"
          aria-invalid={Boolean(timeError)}
          value={minute}
          onChange={(event) => onClockChange({ hour, minute: event.target.value })}
        />
      </label>
      {schedule.mode === "weekly" ? (
        <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
          Weekday
          <select
            className={selectClass}
            aria-label="Weekday"
            value={schedule.weekday}
            onChange={(event) => onChange({ ...schedule, weekday: Number(event.target.value) })}
          >
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>{day}</option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
        Timezone
        <TimezonePicker
          value={schedule.timezone || "UTC"}
          onChange={(timezone) => onChange({ ...schedule, timezone })}
        />
      </label>
    </div>
    {timeError ? <p className="text-xs text-destructive">{timeError}</p> : null}
    </div>
  );
}

function scheduleTimeParts(time: string): { hour: string; minute: string } {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return { hour: "02", minute: "00" };
  return { hour: match[1], minute: match[2] };
}

function normalizeScheduleClock(hourText: string, minuteText: string): string | null {
  const hour = parseClockPart(hourText, 23);
  const minute = parseClockPart(minuteText, 59);
  if (hour == null || minute == null) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseClockPart(value: string, max: number): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (parsed > max) return null;
  return parsed;
}

