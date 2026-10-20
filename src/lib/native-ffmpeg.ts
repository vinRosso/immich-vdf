import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Shared libraries the engine's native FFmpeg binding loads, with their major versions.
 * Keep in step with FFmpeg.AutoGen in engine/VDF.Core (8.x, which needs FFmpeg 8).
 */
const LIBRARIES = [
  ["avcodec", 62],
  ["avdevice", 62],
  ["avfilter", 11],
  ["avformat", 62],
  ["avutil", 60],
  ["swresample", 6],
  ["swscale", 9],
] as const;

type Env = Readonly<Record<string, string | undefined>>;

export type NativeFfmpegPlan = {
  /** Scan with `--native-ffmpeg`: decode inside vdf-cli instead of starting one ffmpeg program per frame. */
  enabled: boolean;
  /** Folder with the FFmpeg 8 libraries on Linux. Windows and macOS look next to vdf-cli. */
  libDir: string | null;
};

/** After a failed download, wait this long before trying again, so an offline machine is not asked on every scan. */
const RETRY_AFTER_FAILURE_MS = 6 * 60 * 60 * 1000;

function libraryFileNames(): string[] {
  return LIBRARIES.map(([name, major]) => `lib${name}.so.${major}`);
}

export type NativeFfmpegMode =
  /** `VDF_NATIVE_FFMPEG=0`. */
  | { kind: "off"; libDir: string | null }
  /** `VDF_NATIVE_FFMPEG=1`, or the Docker image's own libraries are all there. No check, no download. */
  | { kind: "on"; libDir: string | null }
  /** The default: use native decoding when the libraries can be loaded, and fetch them when they cannot. */
  | { kind: "auto"; libDir: string | null };

/**
 * `VDF_NATIVE_FFMPEG=0` keeps the ffmpeg program and `1` forces native mode. Unset is the default: automatic.
 * `VDF_FFMPEG_LIBS` names the folder the Docker image keeps the libraries in; when all of them are there, native mode is
 * used without further checks. The CLI refuses to scan when asked for native mode without the libraries, so an
 * unchecked "on" only comes from the setting or from that folder.
 */
export function nativeFfmpegMode(
  env: Env = process.env,
  exists: (file: string) => boolean = existsSync,
): NativeFfmpegMode {
  const setting = env.VDF_NATIVE_FFMPEG?.trim().toLowerCase();
  const libDir = env.VDF_FFMPEG_LIBS?.trim() || null;
  if (setting === "0" || setting === "false" || setting === "off") return { kind: "off", libDir };
  if (setting === "1" || setting === "true" || setting === "on") return { kind: "on", libDir };
  const shipped = libDir !== null && libraryFileNames().every((file) => exists(path.join(libDir, file)));
  return shipped ? { kind: "on", libDir } : { kind: "auto", libDir };
}

export type NativeFfmpegDeps = {
  /** True when vdf-cli can load the FFmpeg 8 libraries. */
  probe: () => Promise<boolean>;
  /** Download and install them next to vdf-cli. True when that worked. */
  install: () => Promise<boolean>;
  log: (line: string) => void;
  /** The scan was cancelled, so a failed install says nothing about the network. */
  cancelled?: () => boolean;
  now?: () => number;
};

export type NativeState = { available: boolean; failedAt: number | null };

function sharedState(): NativeState {
  const holder = globalThis as typeof globalThis & { __vdfNativeFfmpeg?: NativeState };
  if (!holder.__vdfNativeFfmpeg) holder.__vdfNativeFfmpeg = { available: false, failedAt: null };
  return holder.__vdfNativeFfmpeg;
}

/**
 * Decide, for one scan, whether to decode inside vdf-cli. Automatic mode uses the libraries when they load, downloads
 * them once when they do not, and falls back to the ffmpeg program when that fails, trying again only after a while.
 */
export async function resolveNativeFfmpeg(
  deps: NativeFfmpegDeps,
  env: Env = process.env,
  exists: (file: string) => boolean = existsSync,
  state: NativeState = sharedState(),
): Promise<NativeFfmpegPlan> {
  const mode = nativeFfmpegMode(env, exists);
  if (mode.kind === "off") return { enabled: false, libDir: mode.libDir };
  if (mode.kind === "on") return { enabled: true, libDir: mode.libDir };
  const on = { enabled: true, libDir: mode.libDir };
  const off = { enabled: false, libDir: mode.libDir };
  const now = deps.now ?? Date.now;

  if (state.available) return on;
  if (await deps.probe()) {
    state.available = true;
    return on;
  }
  if (state.failedAt !== null && now() - state.failedAt < RETRY_AFTER_FAILURE_MS) {
    deps.log("[scan] Native FFmpeg is not installed (the last download failed). Scanning with the ffmpeg program.");
    return off;
  }
  deps.log("[scan] Native FFmpeg libraries not found. Downloading them once (about 90 MB, checked against the published checksum).");
  const installed = await deps.install();
  if (installed && (await deps.probe())) {
    state.available = true;
    state.failedAt = null;
    deps.log("[scan] Native FFmpeg is installed. Scanning with it.");
    return on;
  }
  if (!deps.cancelled?.()) {
    state.failedAt = now();
    deps.log("[scan] Native FFmpeg could not be installed. Scanning with the ffmpeg program. It will try again in a few hours.");
  }
  return off;
}

/** Environment for the scan process, so only vdf-cli sees the FFmpeg 8 libraries and not the distro's ffmpeg. */
export function nativeFfmpegEnv(
  plan: NativeFfmpegPlan,
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv | undefined {
  if (!plan.enabled || !plan.libDir || platform === "win32") return undefined;
  const current = env.LD_LIBRARY_PATH;
  return { ...env, LD_LIBRARY_PATH: current ? `${plan.libDir}:${current}` : plan.libDir } as unknown as NodeJS.ProcessEnv;
}

/** Native mode was requested and the scan failed with an exit code, so it is worth one more try without it. */
export function shouldRetryWithoutNative(
  plan: NativeFfmpegPlan,
  result: { code: number | null; spawnFailed: boolean },
  cancelled: boolean,
): boolean {
  return plan.enabled && !cancelled && !result.spawnFailed && result.code !== 0;
}
