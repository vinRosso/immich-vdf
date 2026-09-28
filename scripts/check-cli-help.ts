import { spawnSync } from "node:child_process";
import { REQUIRED_CLI_COMPARE_HELP, REQUIRED_CLI_SCAN_HELP } from "../src/lib/cli-args";

const cli = process.env.VDF_CLI || "vdf-cli";
const command = spawnSync(cli, ["--help"], { encoding: "utf8" });
const scan = spawnSync(cli, ["scan", "--help"], { encoding: "utf8" });
const compare = spawnSync(cli, ["compare", "--help"], { encoding: "utf8" });
const rootText = `${command.stdout ?? ""}\n${command.stderr ?? ""}`;
const scanText = `${scan.stdout ?? ""}\n${scan.stderr ?? ""}\n${rootText}`;
const compareText = `${compare.stdout ?? ""}\n${compare.stderr ?? ""}\n${rootText}`;
if (command.error || scan.error || compare.error) {
  console.error(command.error?.message || scan.error?.message || compare.error?.message || `could not run ${cli}`);
  process.exit(1);
}
const missingScan = REQUIRED_CLI_SCAN_HELP.filter((flag) => !scanText.includes(flag));
const missingCompare = REQUIRED_CLI_COMPARE_HELP.filter((flag) => !compareText.includes(flag));
const missing = [...missingScan, ...missingCompare];
if (missing.length > 0 || command.status !== 0 || scan.status !== 0 || compare.status !== 0) {
  console.error(`vdf-cli help is missing: ${missing.join(", ") || `exit codes ${command.status}/${scan.status}/${compare.status}`}`);
  process.exit(1);
}
console.log(`${cli} scan/compare help includes the flags this app passes`);
