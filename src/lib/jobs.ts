import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildVdfArgs } from "./cli-args";
import { buildVdfCliSettingsFile } from "./vdf-cli-settings";
import { loadConfig, resolveVdfCli } from "./config";
import { resolveImmichScanRoots, type ImmichCredentials } from "./immich-mounts";
import { fetchImmichUser } from "./immich";
import { errorText } from "./errors";
import { assetsForOriginalPaths } from "./immich-asset-index";
import { attachAssets, originalPathsForGroups } from "./immich-join";
import { resolveImmichPathMap } from "./immich-path-map";
import { planImmichScanPaths } from "./immich-scan-scope";
import { ignoreKey, memberIds, pruneIgnoredEntries } from "./ignore";
import { parseCliResults, type ParsedGroup } from "./parse-results";
import { parseResolution } from "./primary";
import { resolveInside } from "./path-jail";
import { redact } from "./redact";
import { getScan } from "./scan";
import { loadIgnored, loadSettings, patchRun, saveIgnored, saveResults, sectionDbDir, secretValues } from "./store";
import { probeImageBitDepth } from "./probe";
import { queueThumbnails } from "./thumbs";
import type { SectionId, Settings, StoredGroup, StoredItem } from "./types";
import { postWebhook } from "./webhook";

export async function startScan(
  section: SectionId,
  trigger: "manual" | "schedule",
  slotKey: string | null = null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const settings = await loadSettings();
  const scanSettings = section === "server" ? settings.server.scan : settings.immich.scan;
  if (scanSettings.includes.length === 0 && section === "server") {
    return { ok: false, status: 400, error: "Add at least one folder to scan" };
  }
  const scan = getScan();
  if (!scan.tryBegin({ section, trigger, secrets: secretValues(settings), slotKey })) {
    return { ok: false, status: 409, error: "A scan is already running" };
  }
  try {
    const creds = section === "immich" ? immichCredentials(settings) : undefined;
    const immichRoots = section === "immich" ? await resolveImmichScanRoots(creds) : [];
    const roots = section === "server" ? loadConfig().mediaRoots : immichRoots;
    const config = loadConfig();
    let includeSources = section === "immich" && scanSettings.includes.length === 0 ? immichRoots : scanSettings.includes;
    let extraExcludes: string[] = [];
    if (section === "immich") {
      let uploadReal = config.immichLibrary;
      try {
        uploadReal = await realpath(config.immichLibrary);
      } catch {
        // Mount may be missing; keep the configured path.
      }
      let uploadChildren: string[] = [];
      try {
        const entries = await readdir(config.immichLibrary, { withFileTypes: true });
        uploadChildren = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      } catch {
        uploadChildren = [];
      }
      const libraryChildren = await directoryNames(path.join(config.immichLibrary, "library"));
      const legacyUploadChildren = await directoryNames(path.join(config.immichLibrary, "upload"));
      let storageLabel: string | null = null;
      let userId: string | null = null;
      if (creds?.baseUrl && creds.apiKey) {
        try {
          const user = await fetchImmichUser(creds.baseUrl, creds.apiKey);
          storageLabel = user.storageLabel;
          userId = user.id;
        } catch {
          // Scan library/ without a user folder when Immich is unreachable.
        }
      }
      const planned = planImmichScanPaths({
        uploadMount: config.immichLibrary,
        uploadMountAliases: [uploadReal],
        scanRoots: immichRoots,
        configuredIncludes: includeSources,
        uploadChildren,
        libraryChildren,
        legacyUploadChildren,
        storageLabel,
        userId,
      });
      includeSources = planned.includes;
      extraExcludes = planned.excludes;
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
    const dbDir = sectionDbDir(section);
    await mkdir(dbDir, { recursive: true });
    const stamp = Date.now();
    const outputFile = path.join(loadConfig().dataDir, "tmp", `scan-${section}-${stamp}.json`);
    const settingsFile = path.join(loadConfig().dataDir, "tmp", `scan-${section}-settings-${stamp}.json`);
    await writeFile(settingsFile, `${JSON.stringify(buildVdfCliSettingsFile(scanSettings))}\n`);
    const args = buildVdfArgs({ ...scanSettings, includes, excludes, dbDir, outputFile, settingsFile });
    const child = spawn(resolveVdfCli(), args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    scan.attach(child);
    child.on("error", () => {
      void finishScan(section, null, outputFile, settingsFile, true);
    });
    child.on("close", (code) => {
      void finishScan(section, code, outputFile, settingsFile, false);
    });
    return { ok: true };
  } catch (error) {
    const message = redact(errorText(error), secretValues(settings));
    scan.abortBegin(message);
    return { ok: false, status: 400, error: message };
  }
}

async function finishScan(
  section: SectionId,
  code: number | null,
  outputFile: string,
  settingsFile: string,
  spawnFailed: boolean,
): Promise<void> {
  const scan = getScan();
  if (!scan.claim()) return;
  const settings = await loadSettings();
  const secrets = secretValues(settings);
  let error: string | null = null;
  let groupCount: number | null = null;
  let ok = false;
  try {
    if (scan.cancelled) error = "Cancelled";
    else if (spawnFailed || code === null) error = "vdf-cli could not be started. Set VDF_CLI or run the Docker image.";
    else if (code !== 0) error = `vdf-cli exited with code ${code}`;
    else {
      const raw = await readFile(outputFile, "utf8");
      let groups = await enrichImageBitDepth(await keepInside(section, parseCliResults(raw).map(toStoredGroup), settings));
      let warning: string | null = null;
      if (section === "immich") {
        if (!settings.immich.baseUrl || !settings.immich.apiKey) {
          warning = "Save the Immich URL and API key to match files to assets.";
        } else {
          try {
            const creds = immichCredentials(settings);
            const maps = await resolveImmichPathMap(creds);
            const assets = await assetsForOriginalPaths(
              settings.immich.baseUrl,
              settings.immich.apiKey,
              originalPathsForGroups(groups, maps),
              settings.immich.scan.includeImages,
            );
            groups = attachAssets(groups, assets, maps);
          } catch (err) {
            warning = "The scan finished, but Immich assets could not be listed, so nothing can be stacked or trashed yet.";
            scan.addLine(redact(errorText(err), secrets));
          }
        }
      }
      await saveResults(section, {
        finishedAt: new Date().toISOString(),
        error: null,
        warning,
        groups,
      });
      const ignoredRaw = await loadIgnored(section);
      const pruned = pruneIgnoredEntries(section, ignoredRaw, groups);
      if (pruned.length !== ignoredRaw.length) await saveIgnored(section, pruned);
      const ignored = pruned;
      const hidden = new Set(ignored.map((entry) => entry.key));
      groupCount = groups.filter((group) => !hidden.has(ignoreKey(memberIds(section, group.items)))).length;
      ok = true;
      if (section === "server") {
        queueThumbnails(groups.flatMap((group) => group.items.filter((item) => !item.isImage).map((item) => item.path)));
      }
    }
  } catch (err) {
    error = redact(errorText(err), secrets);
    ok = false;
  } finally {
    await Promise.all([
      rm(outputFile, { force: true }).catch(() => undefined),
      rm(settingsFile, { force: true }).catch(() => undefined),
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

async function directoryNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function immichCredentials(settings: Settings): ImmichCredentials {
  return { baseUrl: settings.immich.baseUrl, apiKey: settings.immich.apiKey };
}

async function enrichImageBitDepth(groups: StoredGroup[]): Promise<StoredGroup[]> {
  const enriched: StoredGroup[] = [];
  for (const group of groups) {
    const items: StoredItem[] = [];
    for (const item of group.items) {
      if (!item.isImage) {
        items.push(item);
        continue;
      }
      let bitDepth = 0;
      try {
        bitDepth = await probeImageBitDepth(item.path);
      } catch {
        // Leave 0 so tie-breakers still apply.
      }
      items.push({ ...item, bitDepth });
    }
    enriched.push({ ...group, items });
  }
  return enriched;
}

async function keepInside(section: SectionId, groups: StoredGroup[], settings: Settings): Promise<StoredGroup[]> {
  const roots =
    section === "server"
      ? loadConfig().mediaRoots
      : await resolveImmichScanRoots(immichCredentials(settings));
  const kept: StoredGroup[] = [];
  for (const group of groups) {
    const items: StoredItem[] = [];
    for (const item of group.items) {
      try {
        const real = await resolveInside(roots, item.path);
        items.push({ ...item, path: real });
      } catch {
        // Drop paths that are missing or that resolve outside the mount.
      }
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
