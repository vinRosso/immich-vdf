import { execFileSync } from "node:child_process";
import { accessSync, constants, mkdirSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { clampScanParallelism, maxScanParallelism, suggestScanParallelism } from "./scan-parallelism";

export { clampScanParallelism, maxScanParallelism, suggestScanParallelism };

export type ImmichBind = { containerPath: string; hostPath: string };

export type AppConfig = {
  dataDir: string;
  mediaRoots: string[];
  /** Upload library mount inside vdf-web (Compose: `${IMMICH_PATH}` → `/immich`). */
  immichLibrary: string;
  /** Scan roots for the Immich section (upload + external libraries). */
  immichScanRoots: string[];
  /** Container path overlays, such as `/data/library/admin` → a separate host folder. */
  immichBinds: ImmichBind[];
  port: number;
  host: string;
  password: string;
  production: boolean;
  vdfCli: string;
  trustedProxy: string;
  cpuCount: number;
};

export function loadConfig(): AppConfig {
  const cwd = process.cwd();
  const dataDir = process.env.DATA_DIR?.trim() || path.join(cwd, "data");
  const mediaRoots = splitList(process.env.MEDIA_ROOTS, path.join(cwd, "dev-media"));
const immichLibrary =
  process.env.IMMICH_LIBRARY?.trim() || process.env.IMMICH_PATH?.trim() || path.join(cwd, "dev-immich");
  const immichScanRoots = splitList(process.env.IMMICH_SCAN_ROOTS, immichLibrary);
  const immichBinds = parseImmichBinds(process.env.IMMICH_BINDS);
  const cpuCount = Math.max(1, os.cpus().length);
  return {
    dataDir,
    mediaRoots,
    immichLibrary,
    immichScanRoots,
    immichBinds,
    port: Number(process.env.PORT || 47821),
    host: process.env.HOST || "0.0.0.0",
    password: process.env.APP_PASSWORD ?? "",
    production: process.env.NODE_ENV === "production",
    vdfCli: process.env.VDF_CLI?.trim() || "vdf-cli",
    trustedProxy: process.env.TRUSTED_PROXY_CIDR?.trim() || "",
    cpuCount,
  };
}

export function ensureRuntimeDirs(config: AppConfig): void {
  const dirs = [
    config.dataDir,
    path.join(config.dataDir, "db", "server"),
    path.join(config.dataDir, "db", "immich"),
    path.join(config.dataDir, "results"),
    path.join(config.dataDir, "ignore"),
    path.join(config.dataDir, "thumbs"),
    path.join(config.dataDir, "probe"),
    path.join(config.dataDir, "tmp"),
    path.join(config.dataDir, "cli"),
    ...config.mediaRoots,
    config.immichLibrary,
    ...config.immichScanRoots,
  ];
  for (const dir of dirs) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // A read-only Immich mount, or a host path that is not present yet, stays as configured.
    }
  }
}

/** File names to probe for a command on PATH (Windows PATHEXT, e.g. .cmd shims from dotnet tools). */
export function pathExecutableCandidates(command: string): string[] {
  const trimmed = command.trim();
  if (!trimmed) return [];
  if (process.platform !== "win32") return [trimmed];
  const ext = path.extname(trimmed);
  if (ext.length > 1) return [trimmed];
  const names = new Set<string>([trimmed, `${trimmed}.exe`]);
  for (const entry of (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";")) {
    const suffix = entry.trim();
    if (!suffix || suffix.toUpperCase() === ".EXE") continue;
    names.add(trimmed + suffix);
  }
  return [...names];
}

function canExecute(filePath: string): boolean {
  const candidates = path.extname(filePath) ? [filePath] : pathExecutableCandidates(filePath);
  for (const name of candidates) {
    try {
      accessSync(name, constants.X_OK);
      return true;
    } catch {
      // try next candidate
    }
  }
  return false;
}

function resolvesOnPath(command: string): boolean {
  if (process.platform === "win32") {
    try {
      const out = execFileSync("where.exe", [command], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      return out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .some((line) => line.length > 0);
    } catch {
      return false;
    }
  }
  return (process.env.PATH || "")
    .split(path.delimiter)
    .some((dir) => {
      for (const name of pathExecutableCandidates(command)) {
        try {
          accessSync(path.join(dir, name), constants.X_OK);
          return true;
        } catch {
          // try next candidate
        }
      }
      return false;
    });
}

export function cliAvailable(command: string): boolean {
  if (command.includes("/") || command.includes("\\")) {
    return canExecute(command);
  }
  return resolvesOnPath(command);
}

export function resolveVdfCli(config: AppConfig = loadConfig()): string {
  const override = installedCliOverride(config.dataDir);
  if (override) return override;
  const configured = config.vdfCli;
  if (configured.includes("/") || configured.includes("\\")) return configured;
  const dir = process.env.VDF_CLI_DIR?.trim();
  if (dir) {
    const found = findCliInDirectory(dir);
    if (found) return found;
  }
  return configured;
}

function findCliInDirectory(dir: string): string | null {
  const root = path.resolve(dir);
  const queue = [root];
  const seen = new Set<string>();
  while (queue.length > 0 && seen.size < 48) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const name of pathExecutableCandidates("vdf-cli")) {
      const candidate = path.join(current, name);
      if (canExecute(candidate)) return candidate;
    }
    let depth = 0;
    for (const part of path.relative(root, current).split(path.sep)) {
      if (part && part !== ".") depth += 1;
    }
    if (depth >= 2) continue;
    try {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory()) queue.push(path.join(current, entry.name));
      }
    } catch {
      // unreadable directory
    }
  }
  return null;
}

function installedCliOverride(dataDir: string): string | null {
  try {
    const raw = readFileSync(path.join(dataDir, "cli", "active.json"), "utf8");
    const parsed = JSON.parse(raw) as { path?: unknown };
    if (typeof parsed.path !== "string" || !parsed.path.trim()) return null;
    const resolved = path.resolve(parsed.path);
    const root = path.resolve(dataDir, "cli");
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
    return cliAvailable(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function splitList(value: string | undefined, fallback: string): string[] {
  const raw = value?.trim() || fallback;
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

/** `container=/host/path` entries separated by `;`. */
export function parseImmichBinds(raw: string | undefined): ImmichBind[] {
  if (!raw?.trim()) return [];
  const binds: ImmichBind[] = [];
  for (const entry of raw.split(";")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const containerPath = trimmed.slice(0, eq).trim().replace(/\\/g, "/").replace(/\/+$/, "");
    const hostPath = trimmed.slice(eq + 1).trim();
    if (!containerPath.startsWith("/") || !hostPath) continue;
    binds.push({ containerPath, hostPath });
  }
  return binds;
}
