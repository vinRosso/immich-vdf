import { accessSync, constants, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type AppConfig = {
  dataDir: string;
  mediaRoots: string[];
  /** Upload library mount inside vdf-web (Compose: `${IMMICH_PATH}` → `/immich`). */
  immichLibrary: string;
  /** Scan roots for the Immich section (upload + external libraries). */
  immichScanRoots: string[];
  port: number;
  host: string;
  password: string;
  production: boolean;
  vdfCli: string;
  trustedProxy: string;
  cpuCount: number;
};

export function suggestFfmpegConcurrency(cores: number): number {
  return Math.min(4, Math.max(1, Math.floor(cores / 2)));
}

/** Hashing parallelism: leave headroom for thumbnails and the OS. */
export function suggestScanParallelism(cores: number): number {
  return Math.min(8, Math.max(1, Math.floor(cores / 4)));
}

export function loadConfig(): AppConfig {
  const cwd = process.cwd();
  const dataDir = process.env.DATA_DIR?.trim() || path.join(cwd, "data");
  const mediaRoots = splitList(process.env.MEDIA_ROOTS, path.join(cwd, "dev-media"));
const immichLibrary =
  process.env.IMMICH_LIBRARY?.trim() || process.env.IMMICH_PATH?.trim() || path.join(cwd, "dev-immich");
  const immichScanRoots = splitList(process.env.IMMICH_SCAN_ROOTS, immichLibrary);
  const cpuCount = Math.max(1, os.cpus().length);
  return {
    dataDir,
    mediaRoots,
    immichLibrary,
    immichScanRoots,
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

function executableNames(command: string): string[] {
  if (process.platform === "win32" && !command.toLowerCase().endsWith(".exe")) {
    return [command, `${command}.exe`];
  }
  return [command];
}

function canExecute(filePath: string): boolean {
  for (const name of executableNames(filePath)) {
    try {
      accessSync(name, constants.X_OK);
      return true;
    } catch {
      // try next candidate
    }
  }
  return false;
}

export function cliAvailable(command: string): boolean {
  if (command.includes("/") || command.includes("\\")) {
    return canExecute(command);
  }
  return (process.env.PATH || "")
    .split(path.delimiter)
    .some((dir) => {
      for (const name of executableNames(command)) {
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

export function resolveVdfCli(config: AppConfig = loadConfig()): string {
  const override = installedCliOverride(config.dataDir);
  return override ?? config.vdfCli;
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
