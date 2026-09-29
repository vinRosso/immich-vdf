import { accessSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const exeName = process.platform === "win32" ? "vdf-cli.exe" : "vdf-cli";
const cliPath = path.join(root, "bin", "vdf-cli", exeName);

try {
  accessSync(cliPath);
  process.exit(0);
} catch {
  const child = spawnSync(process.execPath, ["scripts/build-vdf-cli.ts"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  process.exit(child.status ?? 1);
}
