import { spawnSync } from "node:child_process";
import { REQUIRED_CLI_HELP } from "../src/lib/cli-args";

const cli = process.env.VDF_CLI || "vdf-cli";
const command = spawnSync(cli, ["--help"], { encoding: "utf8" });
const sub = spawnSync(cli, ["scan-and-compare", "--help"], { encoding: "utf8" });
const text = `${command.stdout ?? ""}\n${command.stderr ?? ""}\n${sub.stdout ?? ""}\n${sub.stderr ?? ""}`;
if (command.error || sub.error) {
  console.error(command.error?.message || sub.error?.message || `could not run ${cli}`);
  process.exit(1);
}
const missing = REQUIRED_CLI_HELP.filter((flag) => !text.includes(flag));
if (missing.length > 0 || command.status !== 0) {
  console.error(`vdf-cli help is missing: ${missing.join(", ") || `exit ${command.status}`}`);
  process.exit(1);
}
console.log(`${cli} help includes the flags this app passes`);
