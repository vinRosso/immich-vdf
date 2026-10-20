import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildVdfCompareArgs, buildVdfExifArgs, buildVdfImageTimesArgs, buildVdfScanArgs } from "./cli-args";
import {
  applyCaptureDates,
  applyCaptureDatesToImages,
  collectCaptureTimes,
  needsCaptureDates,
  prefixCacheKey,
  type CaptureTimes,
} from "./capture-times";
import { decideCompareRun } from "./compare-decision";
import { buildVdfCliSettingsFile } from "./vdf-cli-settings";
import { loadConfig, resolveVdfCli } from "./config";
import { resolveImmichScanRoots, type ImmichCredentials } from "./immich-mounts";
import { errorText } from "./errors";
import { assetsForOriginalPaths } from "./immich-asset-index";
import { attachAssets, dropImmichTrashedFromGroups, immichTrashedCredits, originalPathsForGroups } from "./immich-join";
import { listImmichAssetTimes, listImmichStacks, listTrashedImmichAssets } from "./immich";
import { applyLibraryStacks, expandImmichGroups } from "./immich-stack-sync";
import { dropCompleteStacks } from "./immich-stacks";
import { resolveImmichPathMap } from "./immich-path-map";
import { immichScanFolderPlan } from "./immich-scan-scope";
import { ignoreKey, memberIds, pruneIgnoredEntries } from "./ignore";
import { parseCliResults, type ParsedGroup } from "./parse-results";
import { applyPrefixClusters, imagesInScanScopeParallel, overlayKnownItems, parseImageTimes, pathKey, prefixClustersParallel, prefixItem, stripPrefixItems } from "./prefix-groups";
import { PREFIX_CACHE_REVISION, loadPrefixCache, prefixCacheAction, prefixRegroupLine, savePrefixCache } from "./prefix-cache";
import { parseResolution } from "./primary";
import { resolveAgainstRoots, resolveInside, resolveRoots } from "./path-jail";
import { runPool } from "./concurrency";
import { cliFailure, type CliOutcome } from "./cli-failure";
import { nativeFfmpegEnv, nativeFfmpegPlan, shouldRetryWithoutNative } from "./native-ffmpeg";
import { PhaseTimer } from "./phase-timer";
import { slotPatch } from "./schedule";
import { TRASH_DIR } from "./trash-dir";
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
  updateResults,
  saveStoredInventory,
  sectionDbDir,
  secretValues,
} from "./store";
import { probeImageBitDepth } from "./probe";
import type { CompareDecision } from "./compare-decision";
import type { ScanSettings, SectionId, Settings, StoredGroup, StoredItem, StoredResults } from "./types";
import { cancelPosterWarmup, warmSections } from "./thumb-warm";
import { postWebhook } from "./webhook";

type ScanPaths = {
  includes: string[];
  excludes: string[];
  dbDir: string;
  outputFile: string;
  settingsFile: string;
  /** Capture dates handed to compare. Only written when the capture-time window is on. */
  timesFile: string;
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
    prefixSeconds: scheduled.prefixSeconds ?? live.prefixSeconds,
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
  cancelPosterWarmup();
  const startedAt = Date.now();
  try {
    const paths = await resolveScanPaths(section, scanSettings, settings);
    const dbDir = sectionDbDir(section);
    await mkdir(dbDir, { recursive: true });
    const stamp = Date.now();
    const outputFile = path.join(loadConfig().dataDir, "tmp", `scan-${section}-${stamp}.json`);
    const settingsFile = path.join(loadConfig().dataDir, "tmp", `scan-${section}-settings-${stamp}.json`);
    const timesFile = path.join(loadConfig().dataDir, "tmp", `scan-${section}-times-${stamp}.json`);
    await writeFile(settingsFile, `${JSON.stringify(buildVdfCliSettingsFile(scanSettings, paths))}\n`);
    void runScanPipeline(section, scanSettings, { ...paths, dbDir, outputFile, settingsFile, timesFile }, startedAt).catch(() => undefined);
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
  const trashFolders = section === "server" ? roots.map((root) => path.join(root, TRASH_DIR)) : [];
  for (const folder of [...scanSettings.excludes, ...extraExcludes, ...trashFolders]) {
    try {
      excludes.push(await resolveInside(roots, folder));
    } catch {
      // Skip excludes that are not on the mount.
    }
  }
  return { includes, excludes };
}

/** Runs the scan steps. Whatever goes wrong, the run is recorded and the scan lock is released. */
async function runScanPipeline(
  section: SectionId,
  scanSettings: ScanSettings,
  paths: ScanPaths,
  startedAt: number,
): Promise<void> {
  const scan = getScan();
  const timer = new PhaseTimer((line) => scan.addLine(line));
  try {
    await runScanSteps(section, scanSettings, paths, startedAt, timer);
  } catch (error) {
    const message = redact(errorText(error), scan.secrets);
    scan.addLine(message);
    try {
      await finishScan(section, {
        kind: "error",
        code: 1,
        paths,
        scanSettings,
        spawnFailed: false,
        cancelled: false,
        startedAt,
        timer,
        message,
      });
    } catch {
      // Released below.
    }
    scan.finish(false, message, null);
  }
}

async function runScanSteps(
  section: SectionId,
  scanSettings: ScanSettings,
  paths: ScanPaths,
  startedAt: number,
  timer: PhaseTimer,
): Promise<void> {
  const scan = getScan();
  const cancelled = () =>
    finishScan(section, { kind: "error", code: null, paths, scanSettings, spawnFailed: false, cancelled: true, startedAt, timer });

  // Walk the library first: when no file and no matching setting changed, neither CLI step has anything to do.
  scan.addLine("[scan] Checking whether the library changed…");
  let inventory: InventoryEntry[];
  try {
    inventory = await timer.time("Inventory", () =>
      walkScanInventory(paths.includes, paths.excludes, {
        includeImages: scanSettings.includeImages,
        shouldAbort: () => scan.cancelled,
      }),
    );
  } catch (error) {
    const message = `Could not read the library folders: ${redact(errorText(error), scan.secrets)}`;
    scan.addLine(message);
    await finishScan(section, {
      kind: "error",
      code: 1,
      paths,
      scanSettings,
      spawnFailed: false,
      cancelled: false,
      startedAt,
      timer,
      message,
    });
    return;
  }
  if (scan.cancelled) {
    await cancelled();
    return;
  }

  // The window and burst groups use these, and an edited date has to count as a change.
  let capture: CaptureTimes | null = null;
  if (needsCaptureDates(scanSettings)) {
    try {
      capture = await timer.time("Capture dates", () => readCaptureDates(section, scanSettings, inventory));
    } catch (error) {
      scan.addLine(`[scan] Capture dates skipped: ${redact(errorText(error), scan.secrets)}`);
    }
    if (scan.cancelled) {
      await cancelled();
      return;
    }
  }

  const { decision, previous } = await timer.time("Decision", async () => {
    const previous = await loadResults(section);
    const previousInventory = await loadStoredInventory(section);
    return {
      previous,
      decision: decideCompareRun({
        scan: scanSettings,
        inventory,
        previous,
        previousInventory,
        timesFingerprint: capture?.fingerprint,
      }),
    };
  });
  scan.addLine(decision.logMessage);

  if (decision.skipCompare) {
    await finishScan(section, {
      kind: "reuse",
      paths,
      scanSettings,
      inventory,
      decision,
      capture,
      cancelled: false,
      startedAt,
      timer,
    });
    return;
  }

  // Decoding inside vdf-cli is several times faster than one ffmpeg program per frame, when the libraries exist.
  const native = nativeFfmpegPlan();
  const scanArgs = buildVdfScanArgs({ ...scanSettings, ...paths, nativeFfmpeg: native.enabled });
  let scanResult = await timer.time("CLI scan", () => spawnVdfCli(scanArgs, nativeFfmpegEnv(native)));
  if (shouldRetryWithoutNative(native, scanResult, scan.cancelled)) {
    scan.addLine("[scan] Native FFmpeg could not be used. Scanning again with the ffmpeg program.");
    const plainArgs = buildVdfScanArgs({ ...scanSettings, ...paths });
    scanResult = await timer.time("CLI scan (ffmpeg program)", () => spawnVdfCli(plainArgs));
  }
  if (scan.cancelled) {
    await cancelled();
    return;
  }
  if (scanResult.spawnFailed || scanResult.code !== 0) {
    await finishScan(section, {
      kind: "error",
      code: scanResult.code,
      signal: scanResult.signal,
      paths,
      scanSettings,
      spawnFailed: scanResult.spawnFailed,
      cancelled: false,
      startedAt,
      timer,
    });
    return;
  }

  const sendDates = capture !== null && scanSettings.timeWindowDays > 0;
  if (capture && sendDates) await writeFile(paths.timesFile, JSON.stringify(Object.fromEntries(capture.times)));
  const compareArgs = buildVdfCompareArgs({ ...scanSettings, ...paths, timesFile: sendDates ? paths.timesFile : undefined });
  const compareResult = await timer.time("CLI compare", () => spawnVdfCli(compareArgs));
  if (scan.cancelled) {
    await cancelled();
    return;
  }
  await finishScan(section, {
    kind: "compare",
    code: compareResult.code,
    signal: compareResult.signal,
    paths,
    scanSettings,
    inventory,
    decision,
    capture,
    spawnFailed: compareResult.spawnFailed,
    cancelled: false,
    startedAt,
    timer,
    previous,
  });
}

function spawnVdfCli(args: string[], env?: NodeJS.ProcessEnv): Promise<CliOutcome> {
  return new Promise((resolve) => {
    const scan = getScan();
    // Own process group on POSIX, so cancelling reaches the ffmpeg processes vdf-cli started.
    const child = spawn(resolveVdfCli(), args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      ...(env ? { env } : {}),
    });
    scan.attach(child);
    child.on("error", () => resolve({ code: null, signal: null, spawnFailed: true }));
    child.on("close", (code, signal) => resolve({ code, signal, spawnFailed: false }));
  });
}

type FinishInput = {
  startedAt: number;
  timer: PhaseTimer;
} & (
  | {
      kind: "reuse";
      paths: ScanPaths;
      scanSettings: ScanSettings;
      inventory: InventoryEntry[];
      decision: CompareDecision;
      capture: CaptureTimes | null;
      cancelled: boolean;
    }
  | {
      kind: "compare";
      code: number | null;
      signal: NodeJS.Signals | null;
      /** Results from before this run, read once for the decision. Their bit depths seed the new ones. */
      previous: StoredResults | null;
      paths: ScanPaths;
      scanSettings: ScanSettings;
      inventory: InventoryEntry[];
      decision: CompareDecision;
      capture: CaptureTimes | null;
      spawnFailed: boolean;
      cancelled: boolean;
    }
  | {
      kind: "error";
      code: number | null;
      signal?: NodeJS.Signals | null;
      paths: ScanPaths;
      scanSettings: ScanSettings;
      spawnFailed: boolean;
      cancelled: boolean;
      /** Shown as the run's error instead of describing the CLI exit. */
      message?: string;
    }
);

type FinishOutcome = { ok: boolean; error: string | null; groupCount: number | null };

function stoppedText(): string {
  return getScan().interrupted ? "Interrupted by shutdown" : "Cancelled";
}

/** Saves the results and records the run. The scan lock is always released, even when saving fails. */
async function finishScan(section: SectionId, input: FinishInput): Promise<void> {
  const scan = getScan();
  if (!scan.claim()) return;
  const { timer, paths } = input;
  let settings: Settings | null = null;
  let outcome: FinishOutcome = { ok: false, error: null, groupCount: null };
  try {
    scan.addLine("[scan] Finishing up…");
    settings = await loadSettings();
    outcome = await collectResults(section, input, settings);
  } catch (err) {
    outcome = { ok: false, error: redact(errorText(err), scan.secrets), groupCount: null };
  } finally {
    await Promise.all([
      rm(paths.outputFile, { force: true }).catch(() => undefined),
      rm(paths.settingsFile, { force: true }).catch(() => undefined),
      rm(paths.timesFile, { force: true }).catch(() => undefined),
    ]);
  }
  const { ok, groupCount } = outcome;
  const message = scan.cancelled ? stoppedText() : outcome.error;
  const status = ok && !scan.cancelled ? "ok" : "error";
  try {
    const timings = timer.summary();
    if (timings) scan.addLine(timings);
    await patchRun(section, {
      phases: timer.record(),
      at: new Date().toISOString(),
      status,
      groupCount,
      error: message,
      trigger: scan.trigger,
      ...slotPatch(scan.trigger, scan.slotKey, scan.interrupted),
    });
    if (scan.trigger === "schedule" && settings?.webhookUrl) {
      try {
        await postWebhook(settings.webhookUrl, { section, status, groupCount: groupCount ?? 0 });
      } catch (err) {
        scan.addLine(redact(`Webhook failed: ${errorText(err)}`, scan.secrets));
      }
    }
  } catch (err) {
    scan.addLine(redact(`Could not save the run: ${errorText(err)}`, scan.secrets));
  } finally {
    scan.finish(ok && !scan.cancelled, message, groupCount);
    if (ok && !scan.cancelled) void warmSections([section]).catch(() => undefined);
  }
}

async function collectResults(section: SectionId, input: FinishInput, settings: Settings): Promise<FinishOutcome> {
  const scan = getScan();
  const { timer, paths } = input;
  const secrets = secretValues(settings);
  let error: string | null = null;
  let groupCount: number | null = null;
  let ok = false;
  try {
    if (input.cancelled || scan.cancelled) error = stoppedText();
    else if (input.kind === "error") {
      error = input.message ?? cliFailure(input, scan.cliTail());
    } else if (input.kind === "reuse") {
      const existing = await loadResults(section);
      if (!existing) {
        error = "No saved duplicate groups to reuse.";
      } else {
        // Regrouping can be slow and takes the results lock itself, so it runs before the merge below.
        const reused = await reusedGroups(
          section,
          existing,
          input.scanSettings,
          paths,
          input.decision.inventoryFingerprint,
          input.capture,
        );
        const shapeBefore = groupShape(existing.groups);
        // Trash, archive and stack changes made in Immich since the last compare.
        const refreshed =
          section === "immich"
            ? await joinWithImmich(reused.groups, settings, input.scanSettings, timer)
            : { groups: reused.groups, warning: existing.warning ?? null };
        let savedGroups = refreshed.groups;
        await updateResults(section, (current) => {
          if (!current) return null;
          // A trash or stack action may have changed the groups while this ran. Keep its result.
          const untouched = groupShape(current.groups) === shapeBefore;
          savedGroups = untouched ? refreshed.groups : current.groups;
          return {
            ...current,
            warning: untouched ? refreshed.warning : current.warning,
            groups: savedGroups,
            finishedAt: new Date().toISOString(),
            durationMs: pipelineDurationMs(input.startedAt),
            error: null,
            appliedPrefixSeconds: untouched ? reused.appliedPrefixSeconds : current.appliedPrefixSeconds,
            appliedTimesFingerprint: untouched ? reused.appliedTimesFingerprint : current.appliedTimesFingerprint,
          };
        });
        groupCount = await countVisibleGroups(section, savedGroups);
        ok = true;
      }
    } else if (input.spawnFailed || input.code !== 0) {
      error = cliFailure(input, scan.cliTail());
    } else {
      scan.addLine("[scan] Processing results…");
      // Path map, trash list and stack list do not depend on the groups, so they load while files are read.
      const immichFetch =
        section === "immich" && settings.immich.baseUrl && settings.immich.apiKey ? startImmichFetch(settings) : null;
      const visualGroups = await timer.time("Parse results", async () =>
        applyCaptureDates(parseCliResults(await readFile(paths.outputFile, "utf8")).map(toStoredGroup), input.capture),
      );
      const prefixed = await timer.time("Burst groups", () =>
        withPrefixGroups(
          visualGroups,
          paths.dbDir,
          input.scanSettings,
          paths.includes,
          paths.excludes,
          section,
          input.decision.inventoryFingerprint,
          input.capture,
        ),
      );
      const parsed = prefixed.groups;
      const kept = await timer.time("Path check", () =>
        keepInside(
          section,
          parsed,
          settings,
          input.scanSettings.parallelism,
          (done, total) => {
            if (done === 0 || done === total || done % 200 === 0) {
              scan.addLine(`[scan] Processing results… ${done}/${total} paths`);
            }
          },
          () => scan.cancelled,
        ),
      );
      let groups = await timer.time("Bit depth", () =>
        enrichImageBitDepth(
          kept,
          input.scanSettings.parallelism,
          bitDepthsFromResults(input.previous),
          (done, total) => {
            if (done === total || done % 200 === 0) scan.addLine(`[scan] Processing results… ${done}/${total} images`);
          },
          () => scan.cancelled,
        ),
      );
      if (scan.cancelled) {
        error = stoppedText();
      } else {
      let warning: string | null = null;
      if (section === "immich") {
        const joined = await joinWithImmich(groups, settings, input.scanSettings, timer, immichFetch);
        groups = joined.groups;
        warning = joined.warning;
      }
      if (scan.cancelled) {
        error = stoppedText();
      } else {
      await timer.time("Save results", async () => {
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
          compareTimesFingerprint: input.decision.compareTimesFingerprint || null,
          appliedPrefixSeconds: prefixed.applied ? input.scanSettings.prefixSeconds : null,
          appliedTimesFingerprint: prefixed.applied ? (input.capture?.fingerprint ?? null) : null,
        });
        await updateIgnored(section, (ignoredRaw) => {
          const pruned = pruneIgnoredEntries(section, ignoredRaw, groups);
          return pruned.length === ignoredRaw.length ? ignoredRaw : pruned;
        });
        groupCount = await countVisibleGroups(section, groups);
      });
      ok = true;
      }
      }
    }
  } catch (err) {
    error = redact(errorText(err), secrets);
    ok = false;
  }
  return { ok, error, groupCount };
}

/**
 * Match groups to Immich assets, drop what Immich has trashed and apply its stacks. Failures leave the groups as
 * they were and come back as a warning. A reused compare runs this too, so changes made in Immich show up.
 */
async function joinWithImmich(
  groups: StoredGroup[],
  settings: Settings,
  scanSettings: ScanSettings,
  timer: PhaseTimer,
  prefetched?: ReturnType<typeof startImmichFetch> | null,
): Promise<{ groups: StoredGroup[]; warning: string | null }> {
  const scan = getScan();
  const secrets = secretValues(settings);
  if (!settings.immich.baseUrl || !settings.immich.apiKey) {
    return { groups, warning: "Save the Immich URL and API key to match files to assets." };
  }
  try {
    scan.addLine("[scan] Matching Immich library…");
    const creds = immichCredentials(settings);
    const fetched = prefetched ?? startImmichFetch(settings);
    const [maps, trashed] = await timer.time("Immich fetch (waited)", () => Promise.all([fetched.maps, fetched.trashed]));
    const assets = await timer.time("Immich assets", () =>
      assetsForOriginalPaths(
        settings.immich.baseUrl,
        settings.immich.apiKey,
        originalPathsForGroups(groups, maps),
        scanSettings.includeImages,
        scanSettings.parallelism,
        {
          onSearch: (done, total) => {
            if (done === total || done % 200 === 0) scan.addLine(`[scan] Matching Immich library… ${done}/${total} assets`);
          },
          onLibraryFallback: () => scan.addLine("[scan] Matching Immich library… reading every asset"),
        },
        trashed.ids,
      ),
    );
    let joined = attachAssets(groups, assets, maps);
    const immichTrashCredits = immichTrashedCredits(joined, trashed.ids, maps, trashed.originalPaths);
    joined = dropImmichTrashedFromGroups(joined, trashed.ids, maps, trashed.originalPaths);
    scan.addLine("[scan] Reading Immich stacks…");
    try {
      joined = await timer.time("Immich stacks", () =>
        applyLibraryStacks(joined, creds.baseUrl, creds.apiKey, maps, scanSettings.parallelism, fetched.stacks),
      );
    } catch (err) {
      scan.addLine(redact(errorText(err), secrets));
      joined = dropCompleteStacks(await expandImmichGroups(joined, creds.baseUrl, creds.apiKey, maps, scanSettings.parallelism));
    }
    immichTrashCredits.push(...immichTrashedCredits(joined, trashed.ids, maps, trashed.originalPaths));
    joined = dropImmichTrashedFromGroups(joined, trashed.ids, maps, trashed.originalPaths);
    if (immichTrashCredits.length > 0) await creditImmichTrash(immichTrashCredits);
    return { groups: joined, warning: null };
  } catch (err) {
    scan.addLine(redact(errorText(err), secrets));
    return {
      groups,
      warning: "The scan finished, but Immich assets could not be listed, so nothing can be stacked or trashed yet.",
    };
  }
}

/** Capture dates for the inventory: Immich first, then the files themselves. */
async function readCaptureDates(
  section: SectionId,
  scanSettings: ScanSettings,
  inventory: InventoryEntry[],
): Promise<CaptureTimes> {
  const scan = getScan();
  const settings = await loadSettings();
  const configured = Boolean(settings.immich.baseUrl && settings.immich.apiKey);
  const creds = immichCredentials(settings);
  let maps: Awaited<ReturnType<typeof resolveImmichPathMap>> = [];
  if (configured) {
    try {
      maps = await resolveImmichPathMap(creds);
    } catch (error) {
      scan.addLine(`[scan] Immich path map unavailable (${redact(errorText(error), scan.secrets)}).`);
    }
  }
  return collectCaptureTimes(section, inventory, {
    listImmichTimes: configured ? (updatedAfter) => listImmichAssetTimes(creds.baseUrl, creds.apiKey, updatedAfter) : undefined,
    maps,
    readFileDates: (files) => readDatesWithCli(section, files, scanSettings.parallelism),
    log: (line) => scan.addLine(line),
  });
}

/** `vdf-cli exif` over a list of files. Throws when the CLI cannot run, so nothing is saved as "no date". */
async function readDatesWithCli(section: SectionId, files: string[], parallelism: number): Promise<Map<string, string>> {
  const scan = getScan();
  const stamp = Date.now();
  const tmp = path.join(loadConfig().dataDir, "tmp");
  const listFile = path.join(tmp, `scan-${section}-filelist-${stamp}.txt`);
  const outFile = path.join(tmp, `scan-${section}-filedates-${stamp}.json`);
  try {
    await writeFile(listFile, `${files.join("\n")}\n`, "utf8");
    const result = await spawnVdfCli(buildVdfExifArgs(listFile, outFile, parallelism));
    if (result.spawnFailed || result.code !== 0) throw new Error(cliFailure(result, scan.cliTail()));
    const raw = JSON.parse(await readFile(outFile, "utf8")) as Record<string, unknown>;
    const dates = new Map<string, string>();
    for (const [file, value] of Object.entries(raw)) if (typeof value === "string") dates.set(file, value);
    return dates;
  } finally {
    await Promise.all([rm(listFile, { force: true }).catch(() => undefined), rm(outFile, { force: true }).catch(() => undefined)]);
  }
}

/** Immich requests that only need the connection settings. Failures surface where the result is awaited. */
function startImmichFetch(settings: Settings) {
  const creds = immichCredentials(settings);
  const fetched = {
    maps: resolveImmichPathMap(creds),
    trashed: listTrashedImmichAssets(creds.baseUrl, creds.apiKey),
    stacks: listImmichStacks(creds.baseUrl, creds.apiKey),
  };
  for (const pending of Object.values(fetched)) pending.catch(() => undefined);
  return fetched;
}

function groupShape(groups: StoredGroup[]): string {
  let items = 0;
  for (const group of groups) items += group.items.length;
  return `${groups.length}:${items}`;
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

  // At least 8, and never below the scan Parallel value (a setting of 15 stays 15).
  const width = Math.max(8, Math.floor(parallelism) || 1);
  getScan().addLine(`[scan] Reading bit depth (${width} at a time)…`);
  await runPool(
    pending,
    width,
    async (item) => {
      const key = bitDepthKey(item.path, item.sizeBytes);
      let bitDepth = 0;
      try {
        bitDepth = await probeImageBitDepth(item.path, { ffprobe: false });
      } catch {
        bitDepth = 0;
      }
      if (bitDepth <= 0) return;
      depthByKey.set(key, bitDepth);
      done += occurrences.get(key) ?? 1;
      onProgress?.(Math.min(done, images), images);
    },
    shouldAbort,
  );

  if (shouldAbort?.()) return groups;

  const unresolved = pending.filter((item) => !depthByKey.has(bitDepthKey(item.path, item.sizeBytes)));
  await runPool(
    unresolved,
    width,
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

async function reusedGroups(
  section: SectionId,
  existing: { groups: StoredGroup[]; appliedPrefixSeconds?: number | null; appliedTimesFingerprint?: string | null },
  scanSettings: ScanSettings,
  paths: ScanPaths,
  inventoryFingerprint: string,
  capture: CaptureTimes | null,
): Promise<{ groups: StoredGroup[]; appliedPrefixSeconds: number | null; appliedTimesFingerprint: string | null }> {
  const visible = section === "immich" ? dropCompleteStacks(existing.groups) : existing.groups;
  // Burst groups follow the capture dates, so a date edited since they were built means building them again.
  const burstsApply = scanSettings.prefixSeconds > 0 && scanSettings.includeImages;
  const datesSame = !burstsApply || (existing.appliedTimesFingerprint ?? "") === (capture?.fingerprint ?? "");
  if ((existing.appliedPrefixSeconds ?? null) === scanSettings.prefixSeconds && datesSame) {
    return {
      groups: visible,
      appliedPrefixSeconds: scanSettings.prefixSeconds,
      appliedTimesFingerprint: existing.appliedTimesFingerprint ?? null,
    };
  }
  const cache = await loadPrefixCache(section);
  const cacheKey = prefixCacheKey(inventoryFingerprint, capture);
  const base = cache && cache.inventoryFingerprint === cacheKey ? cache.baseGroups : stripPrefixItems(existing.groups);
  const refreshed = await withPrefixGroups(
    base,
    paths.dbDir,
    scanSettings,
    paths.includes,
    paths.excludes,
    section,
    inventoryFingerprint,
    capture,
  );
  if (!refreshed.applied) {
    return {
      groups: visible,
      appliedPrefixSeconds: existing.appliedPrefixSeconds ?? null,
      appliedTimesFingerprint: existing.appliedTimesFingerprint ?? null,
    };
  }
  const overlaid = overlayKnownItems(existing.groups, refreshed.groups);
  return {
    groups: section === "immich" ? dropCompleteStacks(overlaid) : overlaid,
    appliedPrefixSeconds: scanSettings.prefixSeconds,
    appliedTimesFingerprint: capture?.fingerprint ?? null,
  };
}

async function withPrefixGroups(
  visualGroups: StoredGroup[],
  dbDir: string,
  scanSettings: ScanSettings,
  includes: string[],
  excludes: string[],
  section: SectionId,
  rawInventoryFingerprint: string,
  capture: CaptureTimes | null,
): Promise<{ groups: StoredGroup[]; applied: boolean }> {
  const scan = getScan();
  // The saved groups are only good for the dates they were built from.
  const inventoryFingerprint = prefixCacheKey(rawInventoryFingerprint, capture);
  const cache = await loadPrefixCache(section);
  if (scanSettings.prefixSeconds <= 0 || !scanSettings.includeImages) {
    if (cache && cache.inventoryFingerprint === inventoryFingerprint) {
      await savePrefixCache(section, { ...cache, prefixSeconds: 0, clusters: [], baseGroups: visualGroups });
    }
    return { groups: visualGroups, applied: true };
  }
  const action = prefixCacheAction(cache, {
    inventoryFingerprint,
    timeWindowDays: scanSettings.timeWindowDays,
    prefixSeconds: scanSettings.prefixSeconds,
  });
  const timesFile = path.join(loadConfig().dataDir, "tmp", `scan-times-${Date.now()}.json`);
  let images = cache?.images ?? [];
  let clusters = cache?.clusters ?? [];
  let readTimes = false;
  try {
    if (action === "reuse" && cache) {
      scan.addLine(`[scan] Prefix groups reused (${scanSettings.prefixSeconds} s).`);
    } else if (action === "regroup" && cache) {
      scan.addLine(prefixRegroupLine(cache, scanSettings.prefixSeconds, scanSettings.timeWindowDays));
      clusters = await prefixClustersParallel(
        cache.images,
        scanSettings.prefixSeconds,
        scanSettings.parallelism,
        scanSettings.timeWindowDays,
      );
    } else {
      readTimes = true;
      scan.addLine(`[scan] Grouping images by file name and time (up to ${scanSettings.parallelism} workers, one prefix each)…`);
      const listed = await spawnVdfCli(buildVdfImageTimesArgs(dbDir, timesFile));
      if (listed.spawnFailed || listed.code !== 0) {
        scan.addLine("[scan] Could not read image times, so prefix groups were skipped.");
        return { groups: visualGroups, applied: false };
      }
      images = applyCaptureDatesToImages(
        await imagesInScanScopeParallel(
          parseImageTimes(await readFile(timesFile, "utf8")),
          includes,
          excludes,
          scanSettings.parallelism,
        ),
        capture,
      );
      clusters = await prefixClustersParallel(
        images,
        scanSettings.prefixSeconds,
        scanSettings.parallelism,
        scanSettings.timeWindowDays,
      );
    }
    const lookup = new Map(images.map((image) => [pathKey(image.path), prefixItem(image)]));
    const next = applyPrefixClusters(visualGroups, clusters, lookup);
    const created = next.filter((group) => group.groupId.startsWith("prefix:")).length;
    if (created > 0 && action !== "reuse") {
      scan.addLine(`[scan] ${created} name-and-time group${created === 1 ? "" : "s"}`);
    }
    await savePrefixCache(section, {
      revision: PREFIX_CACHE_REVISION,
      inventoryFingerprint,
      timeWindowDays: scanSettings.timeWindowDays,
      prefixSeconds: scanSettings.prefixSeconds,
      images,
      clusters,
      baseGroups: visualGroups,
    });
    return { groups: next, applied: true };
  } catch (error) {
    scan.addLine(`[scan] Prefix groups skipped: ${errorText(error)}`);
    return { groups: visualGroups, applied: false };
  } finally {
    if (readTimes) await rm(timesFile, { force: true }).catch(() => undefined);
  }
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
    pendingSlot: null,
    at: new Date().toISOString(),
    status: "skipped",
    groupCount: 0,
    error: "Missed: the server was busy or switched off for a day",
    trigger: "schedule",
    phases: undefined,
  });
  if (!settings.webhookUrl) return;
  try {
    await postWebhook(settings.webhookUrl, { section, status: "skipped", groupCount: 0 });
  } catch (error) {
    getScan().addLine(redact(`Webhook failed: ${errorText(error)}`, secretValues(settings)));
  }
}
