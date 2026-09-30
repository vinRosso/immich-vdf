import { stat } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { clampScanParallelism } from "./scan-parallelism";
import { exclusive, readJson, writeJson } from "./json-file";
import { defaultScan } from "./scan-defaults";
import { membershipFromResults, type ResultMediaMeta, type ResultsMembership } from "./results-membership";
import type { IgnoredEntry, RunRecord, RunsFile, ScanSettings, SectionId, Settings, StoredResults } from "./types";
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
  return {
    server: {
      scan: defaultScan("server", loadConfig().cpuCount),
      schedule: defaultSchedule(),
    },
    immich: {
      baseUrl: "",
      apiKey: "",
      pathMap: [],
      scan: defaultScan("immich", loadConfig().cpuCount),
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
  /** Bytes of duplicates sent to Immich trash via VDF (cumulative). */
  immichBytesTrashed?: number;
  /** Asset ids already included in immichBytesTrashed, so a later scan does not add them again. */
  immichCountedIds?: string[];
};

export function trashStatsSavedTotal(stats: TrashStats): number {
  return stats.bytesFreed + Math.max(0, stats.immichBytesTrashed ?? 0);
}

export function loadTrashStats(): Promise<TrashStats> {
  return readJson<TrashStats>(trashStatsPath(), { bytesFreed: 0, immichBytesTrashed: 0 });
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
    const current = await readJson<TrashStats>(trashStatsPath(), { bytesFreed: 0, immichBytesTrashed: 0 });
    const next = {
      bytesFreed: current.bytesFreed + Math.max(0, bytes),
      immichBytesTrashed: current.immichBytesTrashed ?? 0,
    };
    await writeJson(trashStatsPath(), next);
    return next;
  });
}

export function addImmichTrashSaved(bytes: number): Promise<TrashStats> {
  return creditImmichTrash([{ id: "", bytes }]);
}

/** Add Immich trash bytes once per asset id. Empty id always counts (tests and manual totals). */
export function creditImmichTrash(items: { id: string; bytes: number }[]): Promise<TrashStats> {
  return exclusive(async () => {
    const current = await readJson<TrashStats & { immichCountedIds?: string[] }>(trashStatsPath(), {
      bytesFreed: 0,
      immichBytesTrashed: 0,
    });
    const seen = new Set(current.immichCountedIds ?? []);
    let added = 0;
    for (const item of items) {
      const bytes = Math.max(0, item.bytes);
      if (!item.id) {
        added += bytes;
        continue;
      }
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      added += bytes;
    }
    const next = {
      bytesFreed: current.bytesFreed,
      immichBytesTrashed: (current.immichBytesTrashed ?? 0) + added,
      immichCountedIds: [...seen],
    };
    await writeJson(trashStatsPath(), next);
    return next;
  });
}

type StoredSettingsFile = {
  server?: {
    scan?: Partial<ScanSettings>;
    ffmpegConcurrency?: number;
    schedule?: Partial<Settings["server"]["schedule"]>;
  };
  immich?: {
    baseUrl?: string;
    apiKey?: string;
    pathMap?: Settings["immich"]["pathMap"];
    scan?: Partial<ScanSettings>;
    schedule?: Partial<Settings["immich"]["schedule"]>;
  };
  webhookUrl?: string;
};

/** Drop the old thumbnail-jobs field and keep Parallel inside this machine's ceiling. */
export function normalizeStoredSettings(raw: StoredSettingsFile | null | undefined): Settings {
  const defaults = defaultSettings();
  if (!raw) return defaults;
  const cores = loadConfig().cpuCount;
  const serverScan = normalizeScanParallelism(defaults.server.scan, raw.server?.scan, cores);
  const legacyJobs = raw.server?.ffmpegConcurrency;
  if (typeof legacyJobs === "number" && raw.server?.scan?.parallelism === 1) {
    serverScan.parallelism = clampScanParallelism(legacyJobs, cores);
  }
  return {
    server: {
      scan: serverScan,
      schedule: { ...defaults.server.schedule, ...raw.server?.schedule },
    },
    immich: {
      ...defaults.immich,
      ...raw.immich,
      scan: normalizeScanParallelism(defaults.immich.scan, raw.immich?.scan, cores),
      schedule: { ...defaults.immich.schedule, ...raw.immich?.schedule },
      pathMap: raw.immich?.pathMap ?? defaults.immich.pathMap,
    },
    webhookUrl: typeof raw.webhookUrl === "string" ? raw.webhookUrl : defaults.webhookUrl,
  };
}

function normalizeScanParallelism(fallback: ScanSettings, patch: Partial<ScanSettings> | undefined, cores: number): ScanSettings {
  const scan = { ...fallback, ...patch };
  scan.parallelism = clampScanParallelism(scan.parallelism, cores);
  return scan;
}

export function loadSettings(): Promise<Settings> {
  return readJson<StoredSettingsFile | null>(settingsPath(), null).then((raw) => normalizeStoredSettings(raw));
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

type CachedMembership = ResultsMembership & { stamp: string; found: boolean };
const membershipCache = new Map<SectionId, CachedMembership>();

/** Asset ids and paths for the current results file. Rebuilt when the file changes. */
export async function resultsMembership(section: SectionId): Promise<CachedMembership> {
  const file = resultsPath(section);
  let stamp = "missing";
  try {
    const info = await stat(file);
    stamp = `${info.mtimeMs}:${info.size}`;
  } catch {
    stamp = "missing";
  }
  const hit = membershipCache.get(section);
  if (hit?.stamp === stamp) return hit;
  const found = stamp !== "missing";
  const membership = found ? membershipFromResults(await loadResults(section)) : membershipFromResults(null);
  const next = { stamp, found, ...membership };
  membershipCache.set(section, next);
  return next;
}

export function saveResults(section: SectionId, results: StoredResults): Promise<void> {
  return exclusive(async () => {
    await writeJson(resultsPath(section), results);
    membershipCache.delete(section);
  });
}

/** Load and save results under the same write lock so two actions cannot overwrite each other. */
export function updateResults(
  section: SectionId,
  mutator: (current: StoredResults | null) => StoredResults | null | Promise<StoredResults | null>,
): Promise<StoredResults | null> {
  return exclusive(async () => {
    const current = await loadResults(section);
    const next = await mutator(current);
    if (!next || next === current) return current;
    await writeJson(resultsPath(section), next);
    membershipCache.delete(section);
    return next;
  });
}

export async function resultMediaMeta(section: SectionId, filePath: string): Promise<ResultMediaMeta | null> {
  const membership = await resultsMembership(section);
  return membership.mediaByPath.get(filePath) ?? null;
}

export function loadIgnored(section: SectionId): Promise<IgnoredEntry[]> {
  return readJson<IgnoredEntry[]>(ignorePath(section), []);
}

export function saveIgnored(section: SectionId, entries: IgnoredEntry[]): Promise<void> {
  return exclusive(() => writeJson(ignorePath(section), entries));
}

export function updateIgnored(
  section: SectionId,
  mutator: (current: IgnoredEntry[]) => IgnoredEntry[] | Promise<IgnoredEntry[]>,
): Promise<IgnoredEntry[]> {
  return exclusive(async () => {
    const current = await loadIgnored(section);
    const next = await mutator(current);
    if (next !== current) await writeJson(ignorePath(section), next);
    return next;
  });
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
