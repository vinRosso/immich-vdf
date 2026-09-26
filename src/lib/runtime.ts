import { cliAvailable, loadConfig, suggestFfmpegConcurrency } from "./config";
import { nextOccurrence } from "./schedule";
import { loadRuns, loadSettings } from "./store";
import type { PublicSettings, RunsResponse, RuntimeInfo } from "./types";

export async function runtimeInfo(): Promise<RuntimeInfo> {
  const config = loadConfig();
  return {
    cpuCount: config.cpuCount,
    suggestedFfmpegConcurrency: suggestFfmpegConcurrency(config.cpuCount),
    mediaRoots: config.mediaRoots,
    immichLibrary: config.immichLibrary,
    cliAvailable: cliAvailable(config.vdfCli),
    cliPath: config.vdfCli,
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
      pathMap: settings.immich.pathMap,
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
