import type { ScanSettings } from "./types";

export function buildVdfArgs(
  scan: ScanSettings & { dbDir: string; outputFile: string },
): string[] {
  const args = ["scan-and-compare"];
  for (const include of scan.includes) args.push("--include", include);
  for (const exclude of scan.excludes) args.push("--exclude", exclude);
  args.push(
    "--threshold",
    String(scan.threshold),
    "--percent",
    String(scan.percent),
    "--parallelism",
    String(scan.parallelism),
    "--db",
    scan.dbDir,
    "--format",
    "json",
    "--output",
    scan.outputFile,
  );
  if (scan.includeImages) args.push("--include-images");
  if (scan.usePhash) args.push("--use-phash");
  if (scan.partialClip) args.push("--partial-clip-detection");
  if (scan.aiMatching) args.push("--ai-matching");
  if (scan.aiPartial) args.push("--ai-partial");
  return args;
}

export const REQUIRED_CLI_HELP = [
  "scan-and-compare",
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
  "--format",
  "--output",
] as const;
