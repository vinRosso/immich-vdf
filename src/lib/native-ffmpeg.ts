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

function libraryFileNames(): string[] {
  return LIBRARIES.map(([name, major]) => `lib${name}.so.${major}`);
}

/**
 * `VDF_NATIVE_FFMPEG=1` turns it on and `0` turns it off. When unset it is on exactly when
 * `VDF_FFMPEG_LIBS` names a folder that holds all the libraries, which is how the Docker image ships them.
 * The CLI refuses to scan when asked for native mode without the libraries, so it is never guessed.
 */
export function nativeFfmpegPlan(
  env: Env = process.env,
  exists: (file: string) => boolean = existsSync,
): NativeFfmpegPlan {
  const setting = env.VDF_NATIVE_FFMPEG?.trim().toLowerCase();
  const libDir = env.VDF_FFMPEG_LIBS?.trim() || null;
  if (setting === "0" || setting === "false" || setting === "off") return { enabled: false, libDir };
  if (setting === "1" || setting === "true" || setting === "on") return { enabled: true, libDir };
  const shipped = libDir !== null && libraryFileNames().every((file) => exists(path.join(libDir, file)));
  return { enabled: shipped, libDir };
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
