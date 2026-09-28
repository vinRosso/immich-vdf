"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/components/api";
import { AppShell } from "@/components/app-shell";
import { FolderPicker, Hint } from "@/components/folder-picker";
import { ScanProfilePicker } from "@/components/scan-profile-picker";
import { ScanLog, useScanFeed } from "@/components/scan-log";
import { ResultGroupCard } from "@/components/group-result-card";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatBytes, formatClock, formatLatestOkRun } from "@/lib/format";
import { sectionLabel } from "@/lib/section-label";
import { pickPrimaryIndex, pickSmallestIndex } from "@/lib/primary";
import {
  DEFAULT_RESULTS_GROUP_SORT,
  RESULTS_GROUP_SORT_OPTIONS,
  isResultsGroupSortId,
  DEFAULT_RESULTS_CARD_SIZE,
  resultsCardGridClass,
  resultsCardSizeStorageKey,
  resultsSortStorageKey,
  sortResultGroups,
  type ResultsGroupSortId,
} from "@/lib/results-sort";
import { Archive, CheckCircle2, LayoutGrid, Loader2, RotateCcw, XCircle } from "lucide-react";
import { defaultScan, normalizeScan } from "@/lib/scan-defaults";
import type { ClientGroup, PublicSettings, ResultsResponse, RunsResponse, RuntimeInfo, ScanSettings, ScheduleSettings, SectionId, TrashEntry } from "@/lib/types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** One entry per distinct clock. Paris, Berlin, and Rome share Central European time. */
const ZONES: { id: string; label: string }[] = [
  { id: "UTC", label: "UTC" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "America/Denver", label: "Denver" },
  { id: "America/Chicago", label: "Chicago" },
  { id: "America/New_York", label: "New York" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Paris", label: "Paris, Berlin, Rome" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Australia/Sydney", label: "Sydney" },
];
const ZONE_ALIASES: Record<string, string> = {
  "Europe/Berlin": "Europe/Paris",
  "Europe/Rome": "Europe/Paris",
  "Europe/Amsterdam": "Europe/Paris",
  "Europe/Brussels": "Europe/Paris",
  "Europe/Madrid": "Europe/Paris",
  "Europe/Zurich": "Europe/Paris",
  "Europe/Vienna": "Europe/Paris",
  "Europe/Stockholm": "Europe/Paris",
  "Europe/Prague": "Europe/Paris",
  "Europe/Warsaw": "Europe/Paris",
  "Europe/Copenhagen": "Europe/Paris",
  "Europe/Oslo": "Europe/Paris",
  "Europe/Budapest": "Europe/Paris",
};

type Draft = {
  scan: ScanSettings;
  schedule: ScheduleSettings;
  ffmpegConcurrency: number;
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
      scan: normalizeScan(saved.scan),
      schedule: saved.schedule,
      ffmpegConcurrency: nextSettings.server.ffmpegConcurrency,
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
          server: { scan: draft.scan, schedule: draft.schedule, ffmpegConcurrency: Number(draft.ffmpegConcurrency) },
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

  async function save() {
    if (!draft || !settings) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await persistDraft();
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
    const defaults = defaultScan();
    setDraft({
      ...draft,
      scan: {
        ...draft.scan,
        threshold: defaults.threshold,
        percent: defaults.percent,
        parallelism: defaults.parallelism,
        includeImages: defaults.includeImages,
        usePhash: defaults.usePhash,
        partialClip: defaults.partialClip,
        aiMatching: defaults.aiMatching,
        aiPartial: defaults.aiPartial,
        compareHorizontallyFlipped: defaults.compareHorizontallyFlipped,
        ignoreBlackPixels: defaults.ignoreBlackPixels,
        ignoreWhitePixels: defaults.ignoreWhitePixels,
      },
      ffmpegConcurrency: runtime?.suggestedFfmpegConcurrency ?? draft.ffmpegConcurrency,
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
                        label="Parallel"
                        hint={
                          runtime
                            ? `How many files to hash at once. This machine has ${runtime.cpuCount} cores. Suggested: ${runtime.suggestedParallelism}.`
                            : "How many files to hash at once."
                        }
                        value={draft.scan.parallelism}
                        onChange={(parallelism) => setDraft({ ...draft, scan: { ...draft.scan, parallelism } })}
                      />
                      {section === "server" && runtime ? (
                        <NumberField label="Thumbnail jobs" hint={`How many thumbnail jobs run at once. This machine has ${runtime.cpuCount} cores. Suggested: ${runtime.suggestedFfmpegConcurrency}.`} value={draft.ffmpegConcurrency} onChange={(ffmpegConcurrency) => setDraft({ ...draft, ffmpegConcurrency })} />
                      ) : null}
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
                      <div className="flex flex-col items-start gap-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <ScheduleFields schedule={draft.schedule} onChange={(schedule) => setDraft({ ...draft, schedule })} zones={zoneList(runtime?.serverTimeZone, draft.schedule.timezone)} />
                          <Button size="sm" variant="outline" className="h-7" onClick={() => void save()} disabled={busy}>
                            Add schedule
                          </Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Label htmlFor="webhook" className="text-xs text-muted-foreground">
                            Finish webhook
                          </Label>
                          <Input
                            id="webhook"
                            className="h-7 w-52 sm:w-64"
                            placeholder={settings?.webhookConfigured ? "Saved. Enter a new URL to replace it." : "https://example.test/hook"}
                            value={draft.webhookUrl}
                            onChange={(event) => setDraft({ ...draft, webhookUrl: event.target.value, clearWebhook: false })}
                          />
                          <Flag label="Clear" hint="Remove the saved finish webhook." checked={draft.clearWebhook} onChange={(clearWebhook) => setDraft({ ...draft, clearWebhook })} />
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <Button
                          className="h-11 min-w-[6.5rem] px-8 text-base"
                          title={runtime && !runtime.cliAvailable ? "vdf-cli is not installed on this machine" : undefined}
                          onClick={() => void scan()}
                          disabled={busy || feed.running || !runtime?.cliAvailable}
                        >
                          {runningHere ? "Scanning" : "Scan"}
                        </Button>
                        <p className="max-w-[9rem] text-center text-[11px] leading-snug text-muted-foreground">
                          {runs?.[section].nextRun ? `Next ${formatClock(runs[section].nextRun)}` : "Not scheduled"}
                        </p>
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
          {notice ? <p className="text-sm text-primary">{notice}</p> : null}
          <ScanLog lines={feed.section === section ? feed.lines : []} running={runningHere} />
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

  const sortedGroups = useMemo(
    () => (results?.groups ? sortResultGroups(results.groups, sortId) : []),
    [results?.groups, sortId],
  );
  const openIndex = openGroupId === null ? -1 : sortedGroups.findIndex((group) => group.groupId === openGroupId);
  const openGroup = openIndex >= 0 ? sortedGroups[openIndex] : null;

  async function openGroupAfterRefresh(advance: boolean, fromIndex: number) {
    const data = await onReload();
    if (!advance || fromIndex < 0) return;
    const groups = data.groups ? sortResultGroups(data.groups, sortId) : [];
    const next = groups[fromIndex] ?? groups[fromIndex - 1];
    setOpenGroupId(next?.groupId ?? null);
  }

  async function archiveGroup(groupId: string) {
    const fromIndex = openGroupId === groupId ? openIndex : -1;
    await api("/api/ignore", { method: "POST", body: JSON.stringify({ section, groupId }) });
    await openGroupAfterRefresh(fromIndex >= 0, fromIndex);
  }

  async function stackAllGroups(keepSmallest: boolean) {
    if (sortedGroups.length === 0) return;
    const label = keepSmallest ? "the smallest file on top" : "the best-quality file on top";
    if (!window.confirm(`Stack all ${sortedGroups.length} visible groups in Immich, with ${label}?`)) return;
    setBulkBusy(true);
    try {
      for (const group of sortedGroups) {
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
    const label = keepSmallest
      ? "keep the smallest copy in each group and trash the rest"
      : "keep the best-quality copy in each group and trash the rest";
    if (!window.confirm(`Trash duplicates in all ${sortedGroups.length} visible groups? This will ${label}.`)) return;
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
            {results.groups.length} {results.groups.length === 1 ? "group" : "groups"}
          </span>
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
          <span className="text-muted-foreground">Finished {formatClock(results.finishedAt)}</span>
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
                  onClick={() => void stackAllGroups(false)}
                >
                  Stack best
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={bulkBusy || sortedGroups.length === 0}
                  onClick={() => void stackAllGroups(true)}
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
                  onClick={() => void trashAllGroups(false)}
                >
                  Keep best, trash rest
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={bulkBusy || sortedGroups.length === 0}
                  onClick={() => void trashAllGroups(true)}
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
        <div className={resultsCardGridClass(cardSize)}>
          {sortedGroups.map((group) => (
            <ResultGroupCard
              key={group.groupId}
              section={section}
              group={group}
              onSelect={() => setOpenGroupId(group.groupId)}
              topRight={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  className="bg-background/90 shadow-sm hover:bg-yellow-400 hover:text-yellow-950 dark:hover:bg-yellow-500 dark:hover:text-yellow-950"
                  aria-label="Archive group"
                  title="Archive group (hide from results)"
                  onClick={() => void archiveGroup(group.groupId)}
                >
                  <Archive className="size-3.5" />
                </Button>
              }
            />
          ))}
        </div>
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
        onActionDone={(advance) => openGroupAfterRefresh(advance, openIndex)}
      />
    </div>
  );
}

type ImmichStatusResponse =
  | { connected: true; baseUrl: string; user: { email: string; name: string } }
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
  onReload: () => Promise<void>;
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
          {status?.user ? <span className="text-foreground">{status.user.name}</span> : null}
          <span className="text-muted-foreground/60">·</span>
          <span className="truncate font-mono text-foreground/90">{displayUrl}</span>
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

function NumberField({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap">
      <Hint text={hint} />
      {label}
      <Input
        className="h-7 w-9 border-0 bg-transparent px-0.5 text-sm font-semibold tabular-nums shadow-none underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground focus-visible:border-0 focus-visible:decoration-foreground focus-visible:ring-0 md:text-sm dark:bg-transparent"
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
  );
}

function Flag({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs">
      <span className="flex items-center gap-1.5">
        {hint ? <Hint text={hint} /> : null}
        {label}
      </span>
      <Switch size="sm" checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function ScheduleFields({
  schedule,
  onChange,
  zones,
}: {
  schedule: ScheduleSettings;
  onChange: (schedule: ScheduleSettings) => void;
  zones: { id: string; label: string }[];
}) {
  const selectClass = "h-7 rounded-lg border border-input bg-popover px-2 text-xs text-popover-foreground [color-scheme:dark]";
  const timezone = canonicalZone(schedule.timezone);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Hint text="A schedule only scans. It never stacks, trashes, or deletes. If a scan is already running, that slot is skipped." />
        Schedule
      </span>
      <select
        className={selectClass}
        aria-label="Schedule"
        value={schedule.mode}
        onChange={(event) => onChange({ ...schedule, mode: event.target.value as ScheduleSettings["mode"] })}
      >
        <option value="off">Off</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
      </select>
      {schedule.mode !== "off" ? (
        <Input className="h-7 w-28 px-2" type="time" aria-label="Schedule time" value={schedule.time} onChange={(event) => onChange({ ...schedule, time: event.target.value })} />
      ) : null}
      {schedule.mode === "weekly" ? (
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
      ) : null}
      <span className="text-xs text-muted-foreground">Timezone</span>
      <select
        className={`${selectClass} max-w-52`}
        aria-label="Timezone"
        value={timezone}
        onChange={(event) => onChange({ ...schedule, timezone: event.target.value })}
      >
        {zones.map((zone) => (
          <option key={zone.id} value={zone.id}>{zone.label}</option>
        ))}
      </select>
    </div>
  );
}

function canonicalZone(zone: string): string {
  return ZONE_ALIASES[zone] ?? zone;
}

function zoneList(serverZone: string | undefined, selected: string): { id: string; label: string }[] {
  const zones = [...ZONES];
  for (const zone of [serverZone, selected]) {
    if (!zone) continue;
    const id = canonicalZone(zone);
    if (!zones.some((entry) => entry.id === id)) zones.push({ id, label: id.replaceAll("_", " ") });
  }
  return zones;
}
