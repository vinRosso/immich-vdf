import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { buildVdfArgs } from "./cli-args";
import { loadConfig } from "./config";
import { errorText } from "./errors";
import { attachAssets } from "./immich-join";
import { listImmichAssets } from "./immich";
import { ignoreKey, memberIds } from "./ignore";
import { parseCliResults, type ParsedGroup } from "./parse-results";
import { parseResolution } from "./primary";
import { resolveInside } from "./path-jail";
import { redact } from "./redact";
import { getScan } from "./scan";
import { loadIgnored, loadSettings, patchRun, saveResults, sectionDbDir, secretValues } from "./store";
import { queueThumbnails } from "./thumbs";
import type { SectionId, StoredGroup, StoredItem } from "./types";
import { postWebhook } from "./webhook";

export async function startScan(
  section: SectionId,
  trigger: "manual" | "schedule",
  slotKey: string | null = null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const settings = await loadSettings();
  const scanSettings = section === "server" ? settings.server.scan : settings.immich.scan;
  if (scanSettings.includes.length === 0) {
    return { ok: false, status: 400, error: "Add at least one folder to scan" };
  }
  const scan = getScan();
  if (!scan.tryBegin({ section, trigger, secrets: secretValues(settings), slotKey })) {
    return { ok: false, status: 409, error: "A scan is already running" };
  }
  try {
    const roots = rootsFor(section);
    const includes: string[] = [];
    for (const folder of scanSettings.includes) includes.push(await resolveInside(roots, folder));
    const excludes: string[] = [];
    for (const folder of scanSettings.excludes) excludes.push(await resolveInside(roots, folder));
    const dbDir = sectionDbDir(section);
    await mkdir(dbDir, { recursive: true });
    const outputFile = path.join(loadConfig().dataDir, "tmp", `scan-${section}-${Date.now()}.json`);
    const args = buildVdfArgs({ ...scanSettings, includes, excludes, dbDir, outputFile });
    const child = spawn(loadConfig().vdfCli, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    scan.attach(child);
    child.on("error", () => {
      void finishScan(section, null, outputFile, true);
    });
    child.on("close", (code) => {
      void finishScan(section, code, outputFile, false);
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
      let groups = await keepInside(section, parseCliResults(raw).map(toStoredGroup));
      let warning: string | null = null;
      if (section === "immich") {
        if (!settings.immich.baseUrl || !settings.immich.apiKey) {
          warning = "Save the Immich URL and API key to match files to assets.";
        } else {
          try {
            const assets = await listImmichAssets(
              settings.immich.baseUrl,
              settings.immich.apiKey,
              settings.immich.scan.includeImages,
            );
            groups = attachAssets(groups, assets, settings.immich.pathMap);
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
      const ignored = await loadIgnored(section);
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
    await rm(outputFile, { force: true }).catch(() => undefined);
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

function rootsFor(section: SectionId): string[] {
  const config = loadConfig();
  return section === "server" ? config.mediaRoots : [config.immichLibrary];
}

async function keepInside(section: SectionId, groups: StoredGroup[]): Promise<StoredGroup[]> {
  const roots = rootsFor(section);
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
