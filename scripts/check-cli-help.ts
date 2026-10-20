import { spawnSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { REQUIRED_CLI_COMBINED_HELP, REQUIRED_CLI_COMPARE_HELP, REQUIRED_CLI_SCAN_HELP } from "../src/lib/cli-args";
import { loadConfig, resolveVdfCli } from "../src/lib/config";

loadEnvConfig(process.cwd());
const cli = resolveVdfCli(loadConfig());
const command = spawnSync(cli, ["--help"], { encoding: "utf8" });
const scan = spawnSync(cli, ["scan", "--help"], { encoding: "utf8" });
const compare = spawnSync(cli, ["compare", "--help"], { encoding: "utf8" });
const combined = spawnSync(cli, ["scan-and-compare", "--help"], { encoding: "utf8" });
const ffmpegStatus = spawnSync(cli, ["ffmpeg", "status", "--help"], { encoding: "utf8" });
const ffmpegInstall = spawnSync(cli, ["ffmpeg", "install", "--help"], { encoding: "utf8" });
const rootText = `${command.stdout ?? ""}\n${command.stderr ?? ""}`;
const scanText = `${scan.stdout ?? ""}\n${scan.stderr ?? ""}\n${rootText}`;
const compareText = `${compare.stdout ?? ""}\n${compare.stderr ?? ""}\n${rootText}`;
const combinedText = `${combined.stdout ?? ""}\n${combined.stderr ?? ""}\n${rootText}`;
if (command.error || scan.error || compare.error || combined.error) {
  console.error(
    command.error?.message || scan.error?.message || compare.error?.message || combined.error?.message || `could not run ${cli}`,
  );
  process.exit(1);
}
const missingScan = REQUIRED_CLI_SCAN_HELP.filter((flag) => !scanText.includes(flag));
const missingCompare = REQUIRED_CLI_COMPARE_HELP.filter((flag) => !compareText.includes(flag));
const missingCombined = REQUIRED_CLI_COMBINED_HELP.filter((flag) => !combinedText.includes(flag));
const missing = [...missingScan, ...missingCompare, ...missingCombined];
if (
  missing.length > 0 || command.status !== 0 ||
  scan.status !== 0 ||
  compare.status !== 0 ||
  combined.status !== 0 ||
  ffmpegStatus.status !== 0 ||
  ffmpegInstall.status !== 0
) {
  console.error(`vdf-cli help is missing: ${missing.join(", ") || `exit codes ${command.status}/${scan.status}/${compare.status}/${combined.status}/${ffmpegStatus.status}/${ffmpegInstall.status}`}`);
  process.exit(1);
}
console.log(`${cli} scan/compare/scan-and-compare help includes the flags this app passes`);
