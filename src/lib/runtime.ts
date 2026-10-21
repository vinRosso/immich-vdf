import { readCliVersion } from "./cli-release";
import { cliAvailable, loadConfig, resolveVdfCli } from "./config";
import { nativeFfmpegEnv, nativeFfmpegMode, runCliQuietly } from "./native-ffmpeg";
import { maxScanParallelism, suggestScanParallelism } from "./scan-parallelism";
import { resolveImmichScanRoots } from "./immich-mounts";
import { resolveImmichPathMapSync } from "./immich-path-map";
import { nextOccurrence } from "./schedule";
import { loadRuns, loadSettings } from "./store";
import type { PublicSettings, RunsResponse, RuntimeInfo } from "./types";

/** The check spawns vdf-cli, and the page asks for runtime info on every load, so the answer is kept for a minute. */
const NATIVE_PROBE_TTL_MS = 60_000;
let nativeProbe: { at: number; available: boolean } | null = null;

/** Runs with the same library path a scan gets, because in the Docker image the libraries are only found through it. */
async function probeNativeFfmpeg(cliPath: string, libDir: string | null): Promise<boolean> {
  if (nativeProbe && Date.now() - nativeProbe.at < NATIVE_PROBE_TTL_MS) return nativeProbe.available;
  const env = nativeFfmpegEnv({ enabled: true, libDir });
  const available = (await runCliQuietly(cliPath, ["ffmpeg", "status"], 10_000, env)) === 0;
  nativeProbe = { at: Date.now(), available };
  return available;
}

export async function runtimeInfo(): Promise<RuntimeInfo> {
  const config = loadConfig();
  const settings = await loadSettings();
  const cliPath = resolveVdfCli(config);
  const available = cliAvailable(cliPath);
  const native = nativeFfmpegMode();
  const mode = native.kind;
  const [cliVersion, immichScanRoots, nativeAvailable] = await Promise.all([
    available ? readCliVersion(cliPath) : Promise.resolve(null),
    resolveImmichScanRoots({ baseUrl: settings.immich.baseUrl, apiKey: settings.immich.apiKey }),
    available && mode !== "off" ? probeNativeFfmpeg(cliPath, native.libDir) : Promise.resolve(null),
  ]);
  return {
    cpuCount: config.cpuCount,
    maxParallelism: maxScanParallelism(config.cpuCount),
    suggestedParallelism: suggestScanParallelism(config.cpuCount),
    mediaRoots: config.mediaRoots,
    immichLibrary: config.immichLibrary,
    immichScanRoots,
    cliAvailable: available,
    cliPath,
    cliVersion,
    nativeFfmpeg: { mode, available: nativeAvailable },
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
