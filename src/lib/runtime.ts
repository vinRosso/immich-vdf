import { compareRelease, latestStableVersion, readCliVersion } from "./cli-release";
import { cliAvailable, loadConfig, resolveVdfCli, suggestFfmpegConcurrency, suggestScanParallelism } from "./config";
import { resolveImmichScanRoots } from "./immich-mounts";
import { resolveImmichPathMapSync } from "./immich-path-map";
import { nextOccurrence } from "./schedule";
import { loadRuns, loadSettings } from "./store";
import type { PublicSettings, RunsResponse, RuntimeInfo } from "./types";

export async function runtimeInfo(): Promise<RuntimeInfo> {
  const config = loadConfig();
  const settings = await loadSettings();
  const cliPath = resolveVdfCli(config);
  const available = cliAvailable(cliPath);
  const [cliVersion, latestVersion, immichScanRoots] = await Promise.all([
    available ? readCliVersion(cliPath) : Promise.resolve(null),
    latestStableVersion().catch(() => null),
    resolveImmichScanRoots({ baseUrl: settings.immich.baseUrl, apiKey: settings.immich.apiKey }),
  ]);
  return {
    cpuCount: config.cpuCount,
    suggestedFfmpegConcurrency: suggestFfmpegConcurrency(config.cpuCount),
    suggestedParallelism: suggestScanParallelism(config.cpuCount),
    mediaRoots: config.mediaRoots,
    immichLibrary: config.immichLibrary,
    immichScanRoots,
    cliAvailable: available,
    cliPath,
    cliVersion,
    latestVersion,
    updateAvailable: compareRelease(cliVersion, latestVersion) === "update",
    serverTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

export async function publicSettings(): Promise<PublicSettings> {
  const settings = await loadSettings();
  return {
    server: settings.server,
    immich: {
      baseUrl: settings.immich.baseUrl,
      apiKeyConfigured: settings.immich.apiKey.length > 0,
      pathMap: resolveImmichPathMapSync(),
      scan: settings.immich.scan,
      schedule: settings.immich.schedule,
    },
    webhookConfigured: settings.webhookUrl.length > 0,
  };
}

export async function runsView(): Promise<RunsResponse> {
  const [settings, runs] = await Promise.all([loadSettings(), loadRuns()]);
  const now = new Date();
  return {
    server: { last: runs.server, nextRun: nextOccurrence(settings.server.schedule, now)?.toISOString() ?? null },
    immich: { last: runs.immich, nextRun: nextOccurrence(settings.immich.schedule, now)?.toISOString() ?? null },
  };
}
