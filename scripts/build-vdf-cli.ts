import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "bin", "vdf-cli");
const project = path.join(root, "engine", "VDF.CLI", "VDF.CLI.csproj");
const exeName = process.platform === "win32" ? "vdf-cli.exe" : "vdf-cli";
const cliPath = path.join(outDir, exeName);
const version = readFileSync(path.join(root, "engine", "fork-version.txt"), "utf8").trim();

const dotnet = spawnSync(
  "dotnet",
  ["publish", project, "-c", "Release", "-o", outDir, `-p:VersionPrefix=${version}`],
  { stdio: "inherit" },
);

if (dotnet.error) {
  console.error(dotnet.error.message);
  console.error("Install the .NET SDK (10.x) from https://dotnet.microsoft.com/download");
  process.exit(1);
}
if (dotnet.status !== 0) {
  process.exit(dotnet.status ?? 1);
}

const rel = path.relative(root, cliPath).split(path.sep).join("/");
console.log(`Built ${cliPath}`);
console.log(`Add to .env: VDF_CLI=${rel.startsWith("..") ? cliPath : `./${rel}`}`);
