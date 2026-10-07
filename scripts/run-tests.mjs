import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const dir = path.join(process.cwd(), "tests");
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".test.ts") || name.endsWith(".test.mjs"))
  .sort()
  .map((name) => path.join(dir, name));

if (files.length === 0) {
  console.error(`No tests found in ${dir}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
