import type { ScanSettings } from "./types";

type VdfScanParams = ScanSettings & {
  includes: string[];
  excludes: string[];
  dbDir: string;
  settingsFile: string;
  /** Decode inside vdf-cli. Only when the FFmpeg 8 libraries are installed, or the scan cannot start. */
  nativeFfmpeg?: boolean;
};

type VdfCompareParams = ScanSettings & {
  dbDir: string;
  outputFile: string;
  settingsFile: string;
  /** JSON of scan path to capture date. Passed only when the capture-time window is on. */
  timesFile?: string;
};

function appendMatchFlags(args: string[], scan: ScanSettings): void {
  args.push(
    "--threshold",
    String(scan.threshold),
    "--percent",
    String(scan.percent),
    "--parallelism",
    String(scan.parallelism),
  );
  if (scan.includeImages) args.push("--include-images");
  if (scan.usePhash) args.push("--use-phash");
  if (scan.partialClip) args.push("--partial-clip-detection");
  if (scan.aiMatching) args.push("--ai-matching");
  if (scan.aiPartial) args.push("--ai-partial");
  if (scan.timeWindowDays > 0) args.push("--time-window-days", String(scan.timeWindowDays));
}

export function buildVdfScanArgs(scan: VdfScanParams): string[] {
  const args = ["scan"];
  for (const include of scan.includes) args.push("--include", include);
  for (const exclude of scan.excludes) args.push("--exclude", exclude);
  appendMatchFlags(args, scan);
  if (scan.nativeFfmpeg) args.push("--native-ffmpeg");
  args.push("--db", scan.dbDir, "--settings", scan.settingsFile);
  return args;
}

export function buildVdfCompareArgs(scan: VdfCompareParams): string[] {
  const args = ["compare"];
  appendMatchFlags(args, scan);
  args.push("--db", scan.dbDir, "--format", "json", "--output", scan.outputFile, "--settings", scan.settingsFile);
  if (scan.timesFile && scan.timeWindowDays > 0) args.push("--times", scan.timesFile);
  return args;
}

/** Capture dates for the files listed (one path per line) in `pathsFile`. */
export function buildVdfExifArgs(pathsFile: string, outputFile: string, parallelism: number): string[] {
  return ["exif", "--paths", pathsFile, "--output", outputFile, "--parallelism", String(Math.max(1, Math.floor(parallelism) || 1))];
}

export function buildVdfImageTimesArgs(dbDir: string, outputFile: string): string[] {
  return ["db", "times", "--db", dbDir, "--output", outputFile];
}

export function buildVdfArgs(
  scan: ScanSettings & { dbDir: string; outputFile: string; settingsFile: string; includes: string[]; excludes: string[] },
): string[] {
  const args = ["scan-and-compare"];
  for (const include of scan.includes) args.push("--include", include);
  for (const exclude of scan.excludes) args.push("--exclude", exclude);
  appendMatchFlags(args, scan);
  args.push("--db", scan.dbDir, "--format", "json", "--output", scan.outputFile, "--settings", scan.settingsFile);
  return args;
}

/** Flags that must appear in `vdf-cli scan --help` (or root help). */
export const REQUIRED_CLI_SCAN_HELP = [
  "scan",
  "--native-ffmpeg",
  "--include",
  "--exclude",
  "--threshold",
  "--percent",
  "--parallelism",
  "--db",
  "--include-images",
  "--use-phash",
  "--partial-clip-detection",
  "--ai-matching",
  "--ai-partial",
  "--settings",
] as const;

/** Flags that must appear in `vdf-cli compare --help`. */
export const REQUIRED_CLI_COMPARE_HELP = [
  "compare",
  "--threshold",
  "--percent",
  "--parallelism",
  "--db",
  "--include-images",
  "--use-phash",
  "--partial-clip-detection",
  "--ai-matching",
  "--ai-partial",
  "--settings",
  "--format",
  "--output",
  "--time-window-days",
  "--times",
  "exif",
] as const;

export const REQUIRED_CLI_HELP = [...REQUIRED_CLI_SCAN_HELP, ...REQUIRED_CLI_COMPARE_HELP] as const;
