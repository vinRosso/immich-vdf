import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildVdfCompareArgs, buildVdfScanArgs } from "./cli-args";
import { decideCompareRun } from "./compare-decision";
import { buildVdfCliSettingsFile } from "./vdf-cli-settings";
import { loadConfig, resolveVdfCli } from "./config";
import { resolveImmichScanRoots, type ImmichCredentials } from "./immich-mounts";
import { errorText } from "./errors";
import { assetsForOriginalPaths } from "./immich-asset-index";
import { attachAssets, dropImmichTrashedFromGroups, immichTrashedCredits, originalPathsForGroups } from "./immich-join";
import { listTrashedImmichAssets } from "./immich";
import { applyLibraryStacks, expandImmichGroups } from "./immich-stack-sync";
import { dropCompleteStacks } from "./immich-stacks";
import { resolveImmichPathMap } from "./immich-path-map";
import { immichScanFolderPlan } from "./immich-scan-scope";
import { ignoreKey, memberIds, pruneIgnoredEntries } from "./ignore";
import { parseCliResults, type ParsedGroup } from "./parse-results";
import { parseResolution } from "./primary";
import { resolveAgainstRoots, resolveInside, resolveRoots } from "./path-jail";
import { runPool } from "./concurrency";
import { redact } from "./redact";
import { getScan } from "./scan";
import { walkScanInventory, type InventoryEntry } from "./scan-inventory";
import {
  creditImmichTrash,
  loadIgnored,
  loadResults,
  loadSettings,
  loadStoredInventory,
  patchRun,
  saveResults,
  updateIgnored,
  saveStoredInventory,
  sectionDbDir,
  secretValues,
} from "./store";
import { probeImageBitDepth } from "./probe";
import type { CompareDecision } from "./compare-decision";
import type { ScanSettings, SectionId, Settings, StoredGroup, StoredItem } from "./types";
import { postWebhook } from "./webhook";

type ScanPaths = {
  includes: string[];
  excludes: string[];
  dbDir: string;
  outputFile: string;
  settingsFile: string;
};

/** Scheduled runs keep the live folders and use the schedule's own matching options. */
function scanSettingsForRun(live: ScanSettings, scheduled: ScanSettings | undefined): ScanSettings {
  if (!scheduled) return live;
  return {
    ...live,
    threshold: scheduled.threshold,
    percent: scheduled.percent,
    parallelism: scheduled.parallelism,
    includeImages: scheduled.includeImages,
    usePhash: scheduled.usePhash,
    partialClip: scheduled.partialClip,
    aiMatching: scheduled.aiMatching,
    aiPartial: scheduled.aiPartial,
    compareHorizontallyFlipped: scheduled.compareHorizontallyFlipped,
    ignoreBlackPixels: scheduled.ignoreBlackPixels,
    ignoreWhitePixels: scheduled.ignoreWhitePixels,
    timeWindowDays: scheduled.timeWindowDays,
  };
}

export async function startScan(
  section: SectionId,
  trigger: "manual" | "schedule",
  slotKey: string | null = null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const settings = await loadSettings();
  const live = section === "server" ? settings.server.scan : settings.immich.scan;
  const scheduled = section === "server" ? settings.server.schedule.scan : settings.immich.schedule.scan;
  const scanSettings = scanSettingsForRun(live, trigger === "schedule" ? scheduled : undefined);
  if (scanSettings.includes.length === 0 && section === "server") {
    return { ok: false, status: 400, error: "Add at least one folder to scan" };
  }
  const scan = getScan();
  if (!scan.tryBegin({ section, trigger, secrets: secretValues(settings), slotKey })) {
    return { ok: false, status: 409, error: "A scan is already running" };
  }
  const startedAt = Date.now();
  try {
    const paths = await resolveScanPaths(section, scanSettings, settings);
    const dbDir = sectionDbDir(section);
    await mkdir(dbDir, { recursive: true });
    const stamp = Date.now();
    const outputFile = path.join(loadConfig().dataDir, "tmp", `scan-${section}-${stamp}.json`);
    const settingsFile = path.join(loadConfig().dataDir, "tmp", `scan-${section}-settings-${stamp}.json`);
    await writeFile(settingsFile, `${JSON.stringify(buildVdfCliSettingsFile(scanSettings))}\n`);
    void runScanPipeline(section, scanSettings, { ...paths, dbDir, outputFile, settingsFile }, startedAt);
    return { ok: true };
  } catch (error) {
    const message = redact(errorText(error), secretValues(settings));
    scan.abortBegin(message);
    return { ok: false, status: 400, error: message };
  }
}

async function resolveScanPaths(
  section: SectionId,
  scanSettings: ScanSettings,
  settings: Settings,
): Promise<{ includes: string[]; excludes: string[] }> {
  const creds = section === "immich" ? immichCredentials(settings) : undefined;
  let roots = section === "server" ? loadConfig().mediaRoots : [];
  let includeSources = scanSettings.includes;
  let extraExcludes: string[] = [];
  if (section === "immich") {
    const planned = await immichScanFolderPlan(scanSettings, creds);
    roots = planned.roots;
    includeSources = planned.includeSources;
    extraExcludes = planned.extraExcludes;
  }
  const includes: string[] = [];
  for (const folder of includeSources) includes.push(await resolveInside(roots, folder));
  const excludes: string[] = [];
  for (const folder of [...scanSettings.excludes, ...extraExcludes]) {
    try {
      excludes.push(await resolveInside(roots, folder));
    } catch {
      // Skip excludes that are not on the mount.
    }
  }
  return { includes, excludes };
}

async function runScanPipeline(
  section: SectionId,
  scanSettings: ScanSettings,
  paths: ScanPaths,
  startedAt: number,
): Promise<void> {
  const scan = getScan();
  const scanArgs = buildVdfScanArgs({ ...scanSettings, ...paths });
  const scanResult = await spawnVdfCli(scanArgs);
  if (scan.cancelled) {
    await finishScan(section, { kind: "error", code: null, paths, scanSettings, spawnFailed: false, cancelled: true, startedAt });
    return;
  }
  if (scanResult.spawnFailed || scanResult.code !== 0) {
    await finishScan(section, {
      kind: "error",
      code: scanResult.code,
      paths,
      scanSettings,
      spawnFailed: scanResult.spawnFailed,
      cancelled: false,
      startedAt,
    });
    return;
  }

  scan.addLine("[scan] Checking whether compare is needed…");
  let inventory: InventoryEntry[];
  try {
    inventory = await walkScanInventory(paths.includes, paths.excludes, () => scan.cancelled);
  } catch (error) {
    scan.addLine(redact(errorText(error), scan.secrets));
    await finishScan(section, {
      kind: "error",
      code: 1,
      paths,
      scanSettings,
      spawnFailed: false,
      cancelled: false,
      startedAt,
    });
    return;
  }
  if (scan.cancelled) {
    await finishScan(section, { kind: "error", code: null, paths, scanSettings, spawnFailed: false, cancelled: true, startedAt });
    return;
  }

  const previous = await loadResults(section);
  const previousInventory = await loadStoredInventory(section);
  const decision = decideCompareRun({
    scan: scanSettings,
    inventory,
    previous,
    previousInventory,
  });
  scan.addLine(decision.logMessage);

  if (decision.skipCompare) {
    await finishScan(section, {
      kind: "reuse",
      paths,
      scanSettings,
      inventory,
      decision,
      cancelled: false,
      startedAt,
    });
    return;
  }

  const compareArgs = buildVdfCompareArgs({ ...scanSettings, ...paths });
  const compareResult = await spawnVdfCli(compareArgs);
  if (scan.cancelled) {
    await finishScan(section, { kind: "error", code: null, paths, scanSettings, spawnFailed: false, cancelled: true, startedAt });
    return;
  }
  await finishScan(section, {
    kind: "compare",
    code: compareResult.code,
    paths,
    scanSettings,
    inventory,
    decision,
    spawnFailed: compareResult.spawnFailed,
    cancelled: false,
    startedAt,
  });
}

function spawnVdfCli(args: string[]): Promise<{ code: number | null; spawnFailed: boolean }> {
  return new Promise((resolve) => {
    const scan = getScan();
    const child = spawn(resolveVdfCli(), args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    scan.attach(child);
    child.on("error", () => resolve({ code: null, spawnFailed: true }));
    child.on("close", (code) => resolve({ code, spawnFailed: false }));
  });
}

type FinishInput = {
  startedAt: number;
} & (
  | {
      kind: "reuse";
      paths: ScanPaths;
      scanSettings: ScanSettings;
      inventory: InventoryEntry[];
      decision: CompareDecision;
      cancelled: boolean;
    }
  | {
      kind: "compare";
      code: number | null;
      paths: ScanPaths;
      scanSettings: ScanSettings;
      inventory: InventoryEntry[];
      decision: CompareDecision;
      spawnFailed: boolean;
      cancelled: boolean;
    }
  | {
      kind: "error";
      code: number | null;
      paths: ScanPaths;
      scanSettings: ScanSettings;
      spawnFailed: boolean;
      cancelled: boolean;
    }
);

async function finishScan(section: SectionId, input: FinishInput): Promise<void> {
  const scan = getScan();
  if (!scan.claim()) return;
  scan.addLine("[scan] Finishing up…");
  const settings = await loadSettings();
  const secrets = secretValues(settings);
  const { paths } = input;
  let error: string | null = null;
  let groupCount: number | null = null;
  let ok = false;
  try {
    if (input.cancelled || scan.cancelled) error = "Cancelled";
    else if (input.kind === "error") {
      if (input.spawnFailed || input.code === null) error = "vdf-cli could not be started. Set VDF_CLI or run the Docker image.";
      else if (input.code !== 0) error = `vdf-cli exited with code ${input.code}`;
    } else if (input.kind === "reuse") {
      const existing = await loadResults(section);
      if (!existing) {
        error = "No saved duplicate groups to reuse.";
      } else {
      const groups = section === "immich" ? dropCompleteStacks(existing.groups) : existing.groups;
      await saveResults(section, {
        ...existing,
        groups,
        finishedAt: new Date().toISOString(),
        durationMs: pipelineDurationMs(input.startedAt),
        error: null,
      });
      groupCount = await countVisibleGroups(section, groups);
        ok = true;
      }
    } else if (input.spawnFailed || input.code === null) {
      error = "vdf-cli could not be started. Set VDF_CLI or run the Docker image.";
    } else if (input.code !== 0) {
      error = `vdf-cli exited with code ${input.code}`;
    } else {
      const raw = await readFile(paths.outputFile, "utf8");
      scan.addLine("[scan] Processing results…");
      const kept = await keepInside(
        section,
        parseCliResults(raw).map(toStoredGroup),
        settings,
        input.scanSettings.parallelism,
        (done, total) => {
          if (done === 0 || done === total || done % 200 === 0) {
            scan.addLine(`[scan] Processing results… ${done}/${total} paths`);
          }
        },
        () => scan.cancelled,
      );
      const previous = await loadResults(section);
      let groups = await enrichImageBitDepth(
        kept,
        input.scanSettings.parallelism,
        bitDepthsFromResults(previous),
        (done, total) => {
          if (done === total || done % 200 === 0) scan.addLine(`[scan] Processing results… ${done}/${total} images`);
        },
        () => scan.cancelled,
      );
      if (scan.cancelled) {
        error = "Cancelled";
      } else {
      let warning: string | null = null;
      if (section === "immich") {
        if (!settings.immich.baseUrl || !settings.immich.apiKey) {
          warning = "Save the Immich URL and API key to match files to assets.";
        } else {
          try {
            scan.addLine("[scan] Matching Immich library…");
            const creds = immichCredentials(settings);
            const maps = await resolveImmichPathMap(creds);
            const trashed = await listTrashedImmichAssets(settings.immich.baseUrl, settings.immich.apiKey);
            const assets = await assetsForOriginalPaths(
              settings.immich.baseUrl,
              settings.immich.apiKey,
              originalPathsForGroups(groups, maps),
              settings.immich.scan.includeImages,
              input.scanSettings.parallelism,
              undefined,
              trashed.ids,
            );
            groups = attachAssets(groups, assets, maps);
            const immichTrashCredits = immichTrashedCredits(groups, trashed.ids, maps, trashed.originalPaths);
            groups = dropImmichTrashedFromGroups(groups, trashed.ids, maps, trashed.originalPaths);
            scan.addLine("[scan] Reading Immich stacks…");
            try {
              groups = await applyLibraryStacks(groups, creds.baseUrl, creds.apiKey, maps);
            } catch (err) {
              scan.addLine(redact(errorText(err), secrets));
              groups = dropCompleteStacks(
                await expandImmichGroups(groups, creds.baseUrl, creds.apiKey, maps, input.scanSettings.parallelism),
              );
            }
            immichTrashCredits.push(...immichTrashedCredits(groups, trashed.ids, maps, trashed.originalPaths));
            groups = dropImmichTrashedFromGroups(groups, trashed.ids, maps, trashed.originalPaths);
            if (immichTrashCredits.length > 0) await creditImmichTrash(immichTrashCredits);
          } catch (err) {
            warning = "The scan finished, but Immich assets could not be listed, so nothing can be stacked or trashed yet.";
            scan.addLine(redact(errorText(err), secrets));
          }
        }
      }
      if (scan.cancelled) {
        error = "Cancelled";
      } else {
      await saveStoredInventory(section, input.inventory);
      await saveResults(section, {
        finishedAt: new Date().toISOString(),
        durationMs: pipelineDurationMs(input.startedAt),
        error: null,
        warning,
        groups,
        compareFingerprint: input.decision.compareFingerprint,
        compareInventoryFingerprint: input.decision.inventoryFingerprint,
        compareSettingsFingerprint: input.decision.settingsFingerprint,
        compareTimeWindowDays: input.scanSettings.timeWindowDays,
      });
      await updateIgnored(section, (ignoredRaw) => {
        const pruned = pruneIgnoredEntries(section, ignoredRaw, groups);
        return pruned.length === ignoredRaw.length ? ignoredRaw : pruned;
      });
      groupCount = await countVisibleGroups(section, groups);
      ok = true;
      }
      }
    }
  } catch (err) {
    error = redact(errorText(err), secrets);
    ok = false;
  } finally {
    await Promise.all([
      rm(paths.outputFile, { force: true }).catch(() => undefined),
      rm(paths.settingsFile, { force: true }).catch(() => undefined),
    ]);
  }
  const message = scan.cancelled ? "Cancelled" : error;
  const status = ok && !scan.cancelled ? "ok" : "error";
  await patchRun(section, {
    at: new Date().toISOString(),
    status,
    groupCount,
    error: message,
    trigger: scan.trigger,
    ...(scan.trigger === "schedule" ? { slotKey: scan.slotKey } : {}),
  });
  if (scan.trigger === "schedule" && settings.webhookUrl) {
    try {
      await postWebhook(settings.webhookUrl, { section, status, groupCount: groupCount ?? 0 });
    } catch (err) {
      scan.addLine(redact(`Webhook failed: ${errorText(err)}`, secrets));
    }
  }
  scan.finish(ok && !scan.cancelled, message, groupCount);
}

/** Wall clock from scan button to saved results (index, hash, compare, Immich join). */
export function pipelineDurationMs(startedAt: number, now = Date.now()): number {
  if (!startedAt) return 0;
  return Math.max(0, now - startedAt);
}

async function countVisibleGroups(section: SectionId, groups: StoredGroup[]): Promise<number> {
  const ignored = await loadIgnored(section);
  const hidden = new Set(ignored.map((entry) => entry.key));
  const source = section === "immich" ? dropCompleteStacks(groups) : groups;
  return source.filter((group) => !hidden.has(ignoreKey(memberIds(section, group.items)))).length;
}

function immichCredentials(settings: Settings): ImmichCredentials {
  return { baseUrl: settings.immich.baseUrl, apiKey: settings.immich.apiKey };
}

function bitDepthKey(path: string, sizeBytes: number): string {
  return `${path}\0${sizeBytes}`;
}

function bitDepthsFromResults(results: { groups: StoredGroup[] } | null): Map<string, number> {
  const depths = new Map<string, number>();
  if (!results) return depths;
  for (const group of results.groups) {
    for (const item of group.items) {
      if (!item.isImage || item.bitDepth <= 0) continue;
      depths.set(bitDepthKey(item.path, item.sizeBytes), item.bitDepth);
    }
  }
  return depths;
}

async function enrichImageBitDepth(
  groups: StoredGroup[],
  parallelism: number,
  known: Map<string, number>,
  onProgress?: (done: number, total: number) => void,
  shouldAbort?: () => boolean,
): Promise<StoredGroup[]> {
  const images = groups.reduce((sum, group) => sum + group.items.filter((item) => item.isImage).length, 0);
  const depthByKey = new Map<string, number>();
  const pending: { path: string; sizeBytes: number }[] = [];
  const seen = new Set<string>();
  let done = 0;
  for (const group of groups) {
    for (const item of group.items) {
      if (!item.isImage) continue;
      const key = bitDepthKey(item.path, item.sizeBytes);
      if (seen.has(key)) continue;
      seen.add(key);
      const reused = known.get(key);
      if (reused && reused > 0) {
        depthByKey.set(key, reused);
        continue;
      }
      pending.push({ path: item.path, sizeBytes: item.sizeBytes });
    }
  }
  const occurrences = new Map<string, number>();
  for (const group of groups) {
    for (const item of group.items) {
      if (!item.isImage) continue;
      const key = bitDepthKey(item.path, item.sizeBytes);
      occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    }
  }
  for (const [key, depth] of depthByKey) {
    if (depth <= 0) continue;
    done += occurrences.get(key) ?? 0;
  }
  if (done > 0) onProgress?.(Math.min(done, images), images);

  await runPool(
    pending,
    parallelism,
    async (item) => {
      const key = bitDepthKey(item.path, item.sizeBytes);
      let bitDepth = 0;
      try {
        bitDepth = await probeImageBitDepth(item.path);
      } catch {
        // Leave 0 so tie-breakers still apply.
      }
      depthByKey.set(key, bitDepth);
      done += occurrences.get(key) ?? 1;
      onProgress?.(Math.min(done, images), images);
    },
    shouldAbort,
  );

  if (shouldAbort?.()) return groups;

  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => {
      if (!item.isImage) return item;
      return { ...item, bitDepth: depthByKey.get(bitDepthKey(item.path, item.sizeBytes)) ?? 0 };
    }),
  }));
}

async function keepInside(
  section: SectionId,
  groups: StoredGroup[],
  settings: Settings,
  parallelism: number,
  onProgress?: (done: number, total: number) => void,
  shouldAbort?: () => boolean,
): Promise<StoredGroup[]> {
  const roots =
    section === "server"
      ? loadConfig().mediaRoots
      : await resolveImmichScanRoots(immichCredentials(settings));
  const resolvedRoots = await resolveRoots(roots);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const item of group.items) {
      if (seen.has(item.path)) continue;
      seen.add(item.path);
      unique.push(item.path);
    }
  }
  const resolved = new Map<string, string>();
  let done = 0;
  onProgress?.(0, unique.length);
  await runPool(
    unique,
    parallelism,
    async (filePath) => {
      try {
        resolved.set(filePath, await resolveAgainstRoots(resolvedRoots, filePath));
      } catch {
        // Drop paths that are missing or that resolve outside the mount.
      }
      done += 1;
      onProgress?.(done, unique.length);
    },
    shouldAbort,
  );
  if (shouldAbort?.()) return [];
  const kept: StoredGroup[] = [];
  for (const group of groups) {
    const items: StoredItem[] = [];
    for (const item of group.items) {
      const real = resolved.get(item.path);
      if (real) items.push({ ...item, path: real });
    }
    if (items.length >= 2) kept.push({ ...group, items });
  }
  return kept;
}

function toStoredGroup(group: ParsedGroup): StoredGroup {
  return { groupId: group.groupId, items: group.items.map(toStoredItem) };
}

function toStoredItem(item: ParsedGroup["items"][number]): StoredItem {
  const { width, height } = parseResolution(item.resolution);
  return {
    path: item.path,
    similarity: item.similarity,
    sizeBytes: item.sizeBytes,
    durationSeconds: item.durationSeconds,
    resolution: item.resolution,
    width,
    height,
    bitrateKbps: item.bitrateKbps,
    bitDepth: 0,
    audioBitrateKbps: item.audioBitrateKbps,
    dateCreatedMs: item.dateCreatedMs,
    flags: item.flags,
    partialClipOffsetSeconds: item.partialClipOffsetSeconds,
    isImage: item.isImage,
    format: item.format,
    fps: item.fps,
    assetId: null,
    originalPath: null,
    stackId: null,
    stackPrimary: false,
  };
}

export async function recordSkipped(section: SectionId, slotKey: string): Promise<void> {
  const settings = await loadSettings();
  await patchRun(section, {
    slotKey,
    at: new Date().toISOString(),
    status: "skipped",
    groupCount: 0,
    error: "A scan was already running",
    trigger: "schedule",
  });
  if (!settings.webhookUrl) return;
  try {
    await postWebhook(settings.webhookUrl, { section, status: "skipped", groupCount: 0 });
  } catch (error) {
    getScan().addLine(redact(`Webhook failed: ${errorText(error)}`, secretValues(settings)));
  }
}
