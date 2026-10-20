import { spawnSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { loadConfig, resolveVdfCli } from "../src/lib/config";

// Installs the FFmpeg 8 shared libraries next to vdf-cli, so scans decode inside it (several times faster).
// A scan does this by itself when they are missing; this is for doing it ahead of time.
loadEnvConfig(process.cwd());
const cli = resolveVdfCli(loadConfig());
const result = spawnSync(cli, ["ffmpeg", "install"], { stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
