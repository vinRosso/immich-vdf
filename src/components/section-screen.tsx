"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/api";
import { AppShell } from "@/components/app-shell";
import { ScanLog, useScanFeed } from "@/components/scan-log";
import { Viewer } from "@/components/viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatBytes, formatClock, formatDuration, formatPercent } from "@/lib/format";
import type { ClientGroup, PublicSettings, ResultsResponse, RunsResponse, RuntimeInfo, ScanSettings, ScheduleSettings, SectionId, TrashEntry } from "@/lib/types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ZONES = ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney"];

type Draft = {
  scan: ScanSettings;
  schedule: ScheduleSettings;
  ffmpegConcurrency: number;
  baseUrl: string;
  apiKey: string;
  clearApiKey: boolean;
  pathMap: { from: string; to: string }[];
  webhookUrl: string;
  clearWebhook: boolean;
};

export function SectionScreen({ section }: { section: SectionId }) {
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
  const [viewer, setViewer] = useState<ClientGroup | null>(null);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; action: () => Promise<void> }>(null);

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
      scan: saved.scan,
      schedule: saved.schedule,
      ffmpegConcurrency: nextSettings.server.ffmpegConcurrency,
      baseUrl: nextSettings.immich.baseUrl,
      apiKey: "",
      clearApiKey: false,
      pathMap: nextSettings.immich.pathMap.length ? nextSettings.immich.pathMap : [{ from: "", to: "" }],
      webhookUrl: "",
      clearWebhook: false,
    });
    if (section === "server") {
      const listed = await api<{ entries: TrashEntry[] }>("/api/trash");
      setTrash(listed.entries);
    }
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

  async function save() {
    if (!draft || !settings) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body =
        section === "server"
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
                pathMap: draft.pathMap.filter((entry) => entry.from.trim() && entry.to.trim()),
                scan: draft.scan,
                schedule: draft.schedule,
              },
              webhookUrl: draft.webhookUrl || undefined,
              clearWebhook: draft.clearWebhook,
            };
      await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
      setNotice("Settings saved.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/scan", { method: "POST", body: JSON.stringify({ section }) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the scan");
    } finally {
      setBusy(false);
    }
  }

  const runningHere = feed.running && feed.section === section;
  const last = runs?.[section].last;
  const roots = section === "server" ? runtime?.mediaRoots ?? [] : runtime ? [runtime.immichLibrary] : [];

  return (
    <AppShell>
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="order-2 space-y-4 lg:order-1">
          <Card>
            <CardHeader>
              <CardTitle>{section === "server" ? "Server folders" : "Immich library"}</CardTitle>
              <CardDescription>
                {section === "server"
                  ? "Scans stay inside the media mounts. Trash is a rename into .vdf-trash on the same mount."
                  : "The library mount is read-only. Stack and trash go through the Immich API, so a deleted file can be restored there."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading || !draft ? (
                <p className="text-sm text-muted-foreground">Loading settings…</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">Mounted: {roots.join(", ") || "none"}</p>
                  {section === "immich" ? <ImmichFields draft={draft} setDraft={setDraft} settings={settings} busy={busy} /> : null}
                  <PathFields label="Include" values={draft.scan.includes} onChange={(includes) => setDraft({ ...draft, scan: { ...draft.scan, includes } })} />
                  <PathFields label="Exclude" values={draft.scan.excludes} onChange={(excludes) => setDraft({ ...draft, scan: { ...draft.scan, excludes } })} />
                  <div className="grid grid-cols-3 gap-2">
                    <NumberField label="Threshold" value={draft.scan.threshold} onChange={(threshold) => setDraft({ ...draft, scan: { ...draft.scan, threshold } })} />
                    <NumberField label="Percent" value={draft.scan.percent} onChange={(percent) => setDraft({ ...draft, scan: { ...draft.scan, percent } })} />
                    <NumberField label="Parallel" value={draft.scan.parallelism} onChange={(parallelism) => setDraft({ ...draft, scan: { ...draft.scan, parallelism } })} />
                  </div>
                  <Flag label="Include images" checked={draft.scan.includeImages} onChange={(includeImages) => setDraft({ ...draft, scan: { ...draft.scan, includeImages } })} />
                  <Flag label="pHash" checked={draft.scan.usePhash} onChange={(usePhash) => setDraft({ ...draft, scan: { ...draft.scan, usePhash } })} />
                  <Flag label="Partial clips" checked={draft.scan.partialClip} onChange={(partialClip) => setDraft({ ...draft, scan: { ...draft.scan, partialClip } })} />
                  <Flag label="AI matching" checked={draft.scan.aiMatching} onChange={(aiMatching) => setDraft({ ...draft, scan: { ...draft.scan, aiMatching } })} />
                  <Flag label="AI partial" checked={draft.scan.aiPartial} onChange={(aiPartial) => setDraft({ ...draft, scan: { ...draft.scan, aiPartial } })} />
                  {section === "server" && runtime ? (
                    <div className="space-y-2">
                      <Label htmlFor="ffmpeg">FFmpeg jobs</Label>
                      <Input
                        id="ffmpeg"
                        type="number"
                        min={1}
                        max={8}
                        value={draft.ffmpegConcurrency}
                        onChange={(event) => setDraft({ ...draft, ffmpegConcurrency: Number(event.target.value) })}
                      />
                      <p className="text-xs text-muted-foreground">
                        This container has {runtime.cpuCount} cores. Suggested: {runtime.suggestedFfmpegConcurrency} (half the cores, at least 1 and at most 4).
                      </p>
                    </div>
                  ) : null}
                  <ScheduleFields schedule={draft.schedule} onChange={(schedule) => setDraft({ ...draft, schedule })} zones={zoneList(runtime?.serverTimeZone)} />
                  <div className="space-y-2">
                    <Label htmlFor="webhook">Finish webhook</Label>
                    <Input
                      id="webhook"
                      placeholder={settings?.webhookConfigured ? "Saved. Enter a new URL to replace it." : "https://example.test/hook"}
                      value={draft.webhookUrl}
                      onChange={(event) => setDraft({ ...draft, webhookUrl: event.target.value, clearWebhook: false })}
                    />
                    <Flag label="Clear saved webhook" checked={draft.clearWebhook} onChange={(clearWebhook) => setDraft({ ...draft, clearWebhook })} />
                  </div>
                  <Button onClick={() => void save()} disabled={busy}>Save</Button>
                </>
              )}
            </CardContent>
          </Card>
          {section === "server" ? (
            <Card>
              <CardHeader>
                <CardTitle>Trash</CardTitle>
                <CardDescription>{trash.length === 0 ? "Nothing is in .vdf-trash." : `${trash.length} file${trash.length === 1 ? "" : "s"} waiting.`}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="max-h-40 space-y-1 overflow-auto text-xs text-muted-foreground">
                  {trash.map((entry) => (
                    <li key={`${entry.mount}/${entry.relative}`}>{entry.relative} · {formatBytes(entry.sizeBytes)}</li>
                  ))}
                </ul>
                <Button
                  variant="destructive"
                  disabled={trash.length === 0 || busy}
                  onClick={() =>
                    setConfirm({
                      title: "Empty trash?",
                      body: "Permanently delete everything in .vdf-trash. This cannot be undone.",
                      action: async () => {
                        await api("/api/trash", { method: "DELETE" });
                        await reload();
                      },
                    })
                  }
                >
                  Empty trash
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </aside>
        <section className="order-1 space-y-4 lg:order-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-heading text-4xl">{section === "server" ? "Server" : "Immich"}</h1>
              <p className="text-sm text-muted-foreground">
                Next run {formatClock(runs?.[section].nextRun ?? null)}
                {last?.at ? ` · Last ${last.status ?? "run"} ${formatClock(last.at)}` : ""}
                {last?.groupCount !== null && last?.groupCount !== undefined ? ` · ${last.groupCount} groups` : ""}
                {last?.error ? ` · ${last.error}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void scan()} disabled={busy || feed.running || !runtime?.cliAvailable}>
                {runningHere ? "Scanning" : "Scan"}
              </Button>
              {feed.running ? (
                <Button variant="outline" onClick={() => void api("/api/scan/cancel", { method: "POST" })}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
          {runtime && !runtime.cliAvailable ? (
            <p className="rounded-xl bg-muted px-3 py-2 text-sm">
              vdf-cli is not on this machine ({runtime.cliPath}). You can still set folders and review saved results. Scans run in the Docker image.
            </p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {notice ? <p className="text-sm text-primary">{notice}</p> : null}
          <ScanLog lines={feed.section === section ? feed.lines : []} running={runningHere} />
          <Results
            section={section}
            results={results}
            loading={loading}
            onOpen={setViewer}
            onIgnore={async (group) => {
              await api("/api/ignore", { method: "POST", body: JSON.stringify({ section, groupId: group.groupId }) });
              await reload();
            }}
            onTrash={(group) => {
              const keep = group.items.find((item) => item.isPrimary) ?? group.items[0];
              setConfirm({
                title: section === "server" ? "Trash the other files?" : "Trash the other assets?",
                body:
                  section === "server"
                    ? "The other files move into .vdf-trash on their mount. Empty trash deletes them for good."
                    : "Matched assets go to the Immich trash, which can restore them. Unmatched files are left alone.",
                action: async () => {
                  if (section === "server") {
                    await api("/api/trash", { method: "POST", body: JSON.stringify({ groupId: group.groupId, keepPath: keep.path }) });
                  } else if (keep.assetId) {
                    await api("/api/immich/trash", { method: "POST", body: JSON.stringify({ groupId: group.groupId, keepId: keep.assetId }) });
                  }
                  await reload();
                },
              });
            }}
          />
        </section>
      </div>
      <Viewer section={section} group={viewer} onClose={() => setViewer(null)} onChanged={() => void reload()} />
      <Dialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                const action = confirm?.action;
                setConfirm(null);
                if (action) void action().catch((err: unknown) => setError(err instanceof Error ? err.message : "Action failed"));
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Results({
  section,
  results,
  loading,
  onOpen,
  onIgnore,
  onTrash,
}: {
  section: SectionId;
  results: ResultsResponse | null;
  loading: boolean;
  onOpen: (group: ClientGroup) => void;
  onIgnore: (group: ClientGroup) => Promise<void>;
  onTrash: (group: ClientGroup) => void;
}) {
  if (loading || !results) return <p className="text-sm text-muted-foreground">Loading results…</p>;
  if (!results.scanned) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No scan yet</CardTitle>
          <CardDescription>
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
      <div className="flex flex-wrap gap-2 text-xs">
        {results.error ? <Badge variant="destructive">Failed</Badge> : null}
        {results.warning ? <Badge variant="secondary">{results.warning}</Badge> : null}
        {results.hiddenIgnored > 0 ? <Badge variant="outline">{results.hiddenIgnored} ignored</Badge> : null}
        {section === "immich" && results.unmatched > 0 ? <Badge variant="destructive">{results.unmatched} unmatched</Badge> : null}
        <span className="text-muted-foreground">Finished {formatClock(results.finishedAt)}</span>
      </div>
      {results.groups.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No groups to review</CardTitle>
            <CardDescription>This scan did not leave a visible duplicate group. Ignored groups stay hidden until a new file joins them.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        results.groups.map((group) => (
          <Card key={group.groupId}>
            <CardHeader>
              <CardTitle>{group.items.length} files</CardTitle>
              <CardDescription>{group.groupId}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-2">
                {group.items.map((item) => (
                  <li key={item.path} className="flex gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      src={section === "immich" && item.assetId ? `/api/immich-thumb?id=${encodeURIComponent(item.assetId)}` : `/api/thumbs?section=server&path=${encodeURIComponent(item.path)}&kind=poster`}
                      className="h-16 w-28 rounded-md bg-black object-cover"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatPercent(item.similarity)} · {item.resolution || "—"} · {Math.round(item.bitrateKbps)} kbps · {formatDuration(item.durationSeconds)}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {item.isPrimary ? <Badge>Best</Badge> : null}
                        {!item.matched ? <Badge variant="destructive">Unmatched</Badge> : null}
                        {item.flags.map((flag) => (
                          <Badge key={flag} variant="secondary">{flag}</Badge>
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => onOpen(group)}>Compare</Button>
                <Button size="sm" variant="secondary" onClick={() => onTrash(group)}>Trash others</Button>
                <Button size="sm" variant="ghost" onClick={() => void onIgnore(group)}>Ignore</Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function ImmichFields({
  draft,
  setDraft,
  settings,
  busy,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  settings: PublicSettings | null;
  busy: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="base-url">Immich URL</Label>
        <Input id="base-url" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="http://immich:2283" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="api-key">API key</Label>
        <Input
          id="api-key"
          type="password"
          value={draft.apiKey}
          placeholder={settings?.immich.apiKeyConfigured ? "Saved on the server. Enter a new key to replace it." : "Paste an API key"}
          onChange={(event) => setDraft({ ...draft, apiKey: event.target.value, clearApiKey: false })}
        />
        <Flag label="Clear saved key" checked={draft.clearApiKey} onChange={(clearApiKey) => setDraft({ ...draft, clearApiKey })} />
      </div>
      <div className="space-y-2">
        <Label>Path map</Label>
        {draft.pathMap.map((entry, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-2">
            <Input
              placeholder="Immich originalPath prefix"
              value={entry.from}
              onChange={(event) => {
                const pathMap = draft.pathMap.slice();
                pathMap[index] = { ...entry, from: event.target.value };
                setDraft({ ...draft, pathMap });
              }}
            />
            <Input
              placeholder="Mount prefix"
              value={entry.to}
              onChange={(event) => {
                const pathMap = draft.pathMap.slice();
                pathMap[index] = { ...entry, to: event.target.value };
                setDraft({ ...draft, pathMap });
              }}
            />
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => setDraft({ ...draft, pathMap: [...draft.pathMap, { from: "", to: "" }] })}>
          Add map
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            setMessage(null);
            void api("/api/immich/test", { method: "POST", body: JSON.stringify({ baseUrl: draft.baseUrl, apiKey: draft.apiKey }) })
              .then(() => setMessage("Immich answered."))
              .catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Connection failed"));
          }}
        >
          Test connection
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setMessage(null);
            void api<{ matched: number }>("/api/immich/rejoin", { method: "POST" })
              .then((body) => setMessage(`Matched ${body.matched} files to assets.`))
              .catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Could not match assets"));
          }}
        >
          Match assets again
        </Button>
      </div>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}

function PathFields({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  const rows = values.length ? values : [""];
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {rows.map((value, index) => (
        <Input
          key={index}
          value={value}
          onChange={(event) => {
            const next = rows.slice();
            next[index] = event.target.value;
            onChange(next.filter((entry, entryIndex) => entry.trim() || entryIndex === next.length - 1));
          }}
        />
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...rows, ""])}>
        Add folder
      </Button>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

function Flag({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
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
  zones: string[];
}) {
  return (
    <div className="space-y-2">
      <Label>Schedule</Label>
      <div className="grid grid-cols-2 gap-2">
        <select
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          value={schedule.mode}
          onChange={(event) => onChange({ ...schedule, mode: event.target.value as ScheduleSettings["mode"] })}
        >
          <option value="off">Off</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
        <Input type="time" value={schedule.time} onChange={(event) => onChange({ ...schedule, time: event.target.value })} />
      </div>
      {schedule.mode === "weekly" ? (
        <select
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
          value={schedule.weekday}
          onChange={(event) => onChange({ ...schedule, weekday: Number(event.target.value) })}
        >
          {WEEKDAYS.map((day, index) => (
            <option key={day} value={index}>{day}</option>
          ))}
        </select>
      ) : null}
      <select
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
        value={schedule.timezone}
        onChange={(event) => onChange({ ...schedule, timezone: event.target.value })}
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>{zone}</option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">A schedule only scans. It never stacks, trashes, or deletes. If a scan is already running, that slot is skipped.</p>
    </div>
  );
}

function zoneList(serverZone: string | undefined): string[] {
  const zones = new Set(ZONES);
  if (serverZone) zones.add(serverZone);
  return [...zones];
}
