import { loadConfig } from "./config";
import { maxScanParallelism } from "./scan-parallelism";
import { resolveImmichScanRoots, type ImmichCredentials } from "./immich-mounts";
import { IMMICH_GENERATED_DIRS, immichScanFolderPlan } from "./immich-scan-scope";
import { AppError } from "./errors";
import { resolveImmichPathMap } from "./immich-path-map";
import { resolveInside } from "./path-jail";
import { isValidTimeZone } from "./schedule";
import { assertHttpUrl } from "./urls";
import { defaultScan } from "./scan-defaults";
import type { ScanSettings, ScheduleSettings, SectionId, Settings, SettingsUpdate } from "./types";

export async function applySettingsUpdate(current: Settings, update: SettingsUpdate): Promise<Settings> {
  const next: Settings = structuredClone(current);
  if (update.server) {
    next.server.scan = mergeScan(next.server.scan, update.server.scan, "server");
    next.server.schedule = mergeSchedule(next.server.schedule, update.server.schedule, "server");
    await jailScan("server", next.server.scan);
  }
  if (update.immich) {
    if (update.immich.baseUrl !== undefined) next.immich.baseUrl = cleanBaseUrl(update.immich.baseUrl);
    if (update.immich.clearApiKey) next.immich.apiKey = "";
    else if (update.immich.apiKey) next.immich.apiKey = update.immich.apiKey.trim().slice(0, 2000);
    next.immich.scan = mergeScan(next.immich.scan, update.immich.scan, "immich");
    next.immich.schedule = mergeSchedule(next.immich.schedule, update.immich.schedule, "immich");
    const creds: ImmichCredentials = { baseUrl: next.immich.baseUrl, apiKey: next.immich.apiKey };
    await jailScan("immich", next.immich.scan, creds);
    next.immich.pathMap = await resolveImmichPathMap(creds);
  }
  if (update.clearWebhook) next.webhookUrl = "";
  else if (update.webhookUrl !== undefined) next.webhookUrl = cleanWebhook(update.webhookUrl);
  return next;
}

function mergeScan(
  current: ScanSettings,
  patch: Partial<ScanSettings> | undefined,
  section: SectionId,
): ScanSettings {
  const next = { ...defaultScan(section), ...current, ...patch };
  next.threshold = integerIn(next.threshold, 0, 10, "Threshold");
  if (!Number.isFinite(next.percent) || next.percent < 0 || next.percent > 100) {
    throw new AppError("Percent must be between 0 and 100");
  }
  next.parallelism = integerIn(next.parallelism, 1, maxScanParallelism(loadConfig().cpuCount), "Parallelism");
  next.includes = stringList(dedupePaths(next.includes.filter((entry) => entry.trim())), "Include folders");
  const excludes = section === "immich" ? stripImmichGeneratedExcludes(next.excludes, loadConfig().immichLibrary) : next.excludes;
  next.excludes = stringList(dedupePaths(excludes.filter((entry) => entry.trim())), "Exclude folders");
  next.includeImages = Boolean(next.includeImages);
  next.usePhash = Boolean(next.usePhash);
  next.partialClip = Boolean(next.partialClip);
  next.aiMatching = Boolean(next.aiMatching);
  next.aiPartial = Boolean(next.aiPartial);
  next.compareHorizontallyFlipped = Boolean(next.compareHorizontallyFlipped);
  next.ignoreBlackPixels = Boolean(next.ignoreBlackPixels);
  next.ignoreWhitePixels = Boolean(next.ignoreWhitePixels);
  if (!Number.isFinite(next.timeWindowDays) || next.timeWindowDays < 0) {
    throw new AppError("Time window must be 0 (all) or at least 1 day");
  }
  next.timeWindowDays = next.timeWindowDays === 0 ? 0 : Math.max(1, Math.round(next.timeWindowDays));
  return next;
}

function mergeSchedule(
  current: ScheduleSettings,
  patch: Partial<ScheduleSettings> | undefined,
  section: SectionId,
): ScheduleSettings {
  const next: ScheduleSettings = {
    mode: patch?.mode ?? current.mode,
    time: patch?.time ?? current.time,
    weekday: patch?.weekday ?? current.weekday,
    timezone: patch?.timezone ?? current.timezone,
    scan: current.scan,
  };
  if (next.mode !== "off" && next.mode !== "daily" && next.mode !== "weekly") {
    throw new AppError("Schedule must be off, daily, or weekly");
  }
  const clock = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(next.time);
  if (!clock) throw new AppError("Schedule time must be HH:mm");
  next.time = `${clock[1]}:${clock[2]}`;
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (hour > 23 || minute > 59) throw new AppError("Schedule time must be HH:mm");
  next.weekday = integerIn(next.weekday, 0, 6, "Weekday");
  if (!isValidTimeZone(next.timezone)) throw new AppError("Timezone is not recognized");
  if (patch?.scan) next.scan = mergeScan(current.scan ?? defaultScan(section), patch.scan, section);
  return next;
}

async function jailScan(section: SectionId, scan: ScanSettings, immichCreds?: ImmichCredentials): Promise<void> {
  const config = loadConfig();
  let roots = section === "server" ? config.mediaRoots : [];
  let includeSources = scan.includes;
  let extraExcludes: string[] = [];
  if (section === "immich") {
    const planned = await immichScanFolderPlan(scan, immichCreds);
    roots = planned.roots;
    includeSources = planned.includeSources;
    extraExcludes = planned.extraExcludes;
  }
  const includes: string[] = [];
  for (const folder of includeSources) includes.push(await resolveInside(roots, folder));
  const excludes: string[] = [];
  for (const folder of scan.excludes) {
    try {
      excludes.push(await resolveInside(roots, folder));
    } catch {
      // Skip excludes that are not on the mount.
    }
  }
  for (const folder of extraExcludes) {
    try {
      await resolveInside(roots, folder);
    } catch {
      // Immich generated dirs may be absent on the mount; scan still adds them at runtime.
    }
  }
  scan.includes = includes;
  scan.excludes = excludes;
}

function slash(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of paths) {
    const key = slash(entry).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry.trim());
  }
  return out;
}

/** Drop Immich auto-excludes that were mistakenly persisted on older saves. */
function stripImmichGeneratedExcludes(excludes: string[], libraryMount: string): string[] {
  const mount = slash(libraryMount).toLowerCase();
  if (!mount) return excludes;
  return excludes.filter((entry) => {
    const normalized = slash(entry).toLowerCase();
    for (const name of IMMICH_GENERATED_DIRS) {
      if (normalized === `${mount}/${name}`) return false;
    }
    return true;
  });
}

function stringList(value: string[], label: string): string[] {
  if (!Array.isArray(value)) throw new AppError(`${label} must be a list`);
  if (value.length > 100) throw new AppError(`${label} has too many entries`);
  return value.map((entry) => {
    if (typeof entry !== "string" || entry.trim().length === 0 || entry.length > 4096) {
      throw new AppError(`${label} contains an invalid path`);
    }
    return entry.trim();
  });
}

function integerIn(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AppError(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function cleanBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  assertHttpUrl(trimmed);
  return trimmed.replace(/\/+$/, "");
}

function cleanWebhook(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  assertHttpUrl(trimmed);
  return trimmed;
}

