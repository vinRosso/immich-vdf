import path from "node:path";
import { loadConfig, suggestFfmpegConcurrency } from "./config";
import { exclusive, readJson, writeJson } from "./json-file";
import { defaultScan } from "./scan-defaults";
import type { IgnoredEntry, RunRecord, RunsFile, SectionId, Settings, StoredResults } from "./types";
import type { InventoryEntry } from "./scan-inventory";

export { defaultScan } from "./scan-defaults";

export function defaultSchedule() {
  return {
    mode: "off" as const,
    time: "03:00",
    weekday: 0,
    timezone: "UTC",
  };
}

export function emptyRun(): RunRecord {
  return {
    slotKey: null,
    at: null,
    status: null,
    groupCount: null,
    error: null,
    trigger: null,
  };
}

export function defaultSettings(): Settings {
  const cores = loadConfig().cpuCount;
  return {
    server: {
      scan: defaultScan(),
      ffmpegConcurrency: suggestFfmpegConcurrency(cores),
      schedule: defaultSchedule(),
    },
    immich: {
      baseUrl: "",
      apiKey: "",
      pathMap: [],
      scan: defaultScan(),
      schedule: defaultSchedule(),
    },
    webhookUrl: "",
  };
}

function settingsPath(): string {
  return path.join(loadConfig().dataDir, "settings.json");
}

function resultsPath(section: SectionId): string {
  return path.join(loadConfig().dataDir, "results", `${section}.json`);
}

function ignorePath(section: SectionId): string {
  return path.join(loadConfig().dataDir, "ignore", `${section}.json`);
}

function runsPath(): string {
  return path.join(loadConfig().dataDir, "runs.json");
}

function trashStatsPath(): string {
  return path.join(loadConfig().dataDir, "trash-stats.json");
}

export type TrashStats = {
  bytesFreed: number;
};

export function loadTrashStats(): Promise<TrashStats> {
  return readJson<TrashStats>(trashStatsPath(), { bytesFreed: 0 });
}

function trashAddedPath(): string {
  return path.join(loadConfig().dataDir, "trash-added.json");
}

export function trashAddedKey(mount: string, relative: string): string {
  return `${mount}\n${relative}`;
}

export function loadTrashAdded(): Promise<Record<string, number>> {
  return readJson<Record<string, number>>(trashAddedPath(), {});
}

export function rememberTrashAdded(mount: string, relative: string, atMs = Date.now()): Promise<void> {
  return rememberTrashAddedMany([{ mount, relative, atMs }]);
}

export function rememberTrashAddedMany(items: { mount: string; relative: string; atMs: number }[]): Promise<void> {
  if (items.length === 0) return Promise.resolve();
  return exclusive(async () => {
    const current = await readJson<Record<string, number>>(trashAddedPath(), {});
    for (const item of items) current[trashAddedKey(item.mount, item.relative)] = item.atMs;
    await writeJson(trashAddedPath(), current);
  });
}

export function forgetTrashAdded(keys: string[]): Promise<void> {
  return exclusive(async () => {
    const current = await readJson<Record<string, number>>(trashAddedPath(), {});
    for (const key of keys) delete current[key];
    await writeJson(trashAddedPath(), current);
  });
}

export function clearTrashAdded(): Promise<void> {
  return exclusive(() => writeJson(trashAddedPath(), {}));
}

export function addTrashFreed(bytes: number): Promise<TrashStats> {
  return exclusive(async () => {
    const current = await readJson<TrashStats>(trashStatsPath(), { bytesFreed: 0 });
    const next = { bytesFreed: current.bytesFreed + Math.max(0, bytes) };
    await writeJson(trashStatsPath(), next);
    return next;
  });
}

export function loadSettings(): Promise<Settings> {
  return readJson(settingsPath(), defaultSettings());
}

export function saveSettings(settings: Settings): Promise<void> {
  return exclusive(() => writeJson(settingsPath(), settings));
}

export function updateSettings(mutator: (settings: Settings) => Settings | Promise<Settings>): Promise<Settings> {
  return exclusive(async () => {
    const current = await loadSettings();
    const next = await mutator(current);
    await writeJson(settingsPath(), next);
    return next;
  });
}

export function loadResults(section: SectionId): Promise<StoredResults | null> {
  return readJson<StoredResults | null>(resultsPath(section), null);
}

export function saveResults(section: SectionId, results: StoredResults): Promise<void> {
  return exclusive(() => writeJson(resultsPath(section), results));
}

export function loadIgnored(section: SectionId): Promise<IgnoredEntry[]> {
  return readJson<IgnoredEntry[]>(ignorePath(section), []);
}

export function saveIgnored(section: SectionId, entries: IgnoredEntry[]): Promise<void> {
  return exclusive(() => writeJson(ignorePath(section), entries));
}

export async function loadRuns(): Promise<RunsFile> {
  const fallback = { server: emptyRun(), immich: emptyRun() };
  const stored = await readJson<Partial<RunsFile>>(runsPath(), fallback);
  return {
    server: { ...emptyRun(), ...stored.server },
    immich: { ...emptyRun(), ...stored.immich },
  };
}

export function saveRuns(runs: RunsFile): Promise<void> {
  return exclusive(() => writeJson(runsPath(), runs));
}

export async function patchRun(section: SectionId, patch: Partial<RunRecord>): Promise<RunRecord> {
  return exclusive(async () => {
    const runs = await loadRuns();
    const next = { ...runs[section], ...patch };
    if (patch.slotKey === undefined) next.slotKey = runs[section].slotKey;
    runs[section] = next;
    await writeJson(runsPath(), runs);
    return next;
  });
}

export function sectionDbDir(section: SectionId): string {
  return path.join(loadConfig().dataDir, "db", section);
}

type StoredInventoryFile = { entries: InventoryEntry[] };

function inventoryPath(section: SectionId): string {
  return path.join(loadConfig().dataDir, "inventory", `${section}.json`);
}

export function loadStoredInventory(section: SectionId): Promise<InventoryEntry[] | null> {
  return readJson<StoredInventoryFile | null>(inventoryPath(section), null).then((file) => file?.entries ?? null);
}

export function saveStoredInventory(section: SectionId, entries: InventoryEntry[]): Promise<void> {
  return exclusive(() => writeJson(inventoryPath(section), { entries }));
}

export function secretValues(settings: Settings): string[] {
  return [settings.immich.apiKey, settings.webhookUrl, loadConfig().password];
}
