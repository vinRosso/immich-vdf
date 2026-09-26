import { accessSync, constants, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type AppConfig = {
  dataDir: string;
  mediaRoots: string[];
  immichLibrary: string;
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

export function loadConfig(): AppConfig {
  const cwd = process.cwd();
  const dataDir = process.env.DATA_DIR?.trim() || path.join(cwd, "data");
  const mediaRoots = splitList(process.env.MEDIA_ROOTS, path.join(cwd, "dev-media"));
  const immichLibrary = process.env.IMMICH_LIBRARY?.trim() || path.join(cwd, "dev-immich");
  const cpuCount = Math.max(1, os.cpus().length);
  return {
    dataDir,
    mediaRoots,
    immichLibrary,
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
    ...config.mediaRoots,
    config.immichLibrary,
  ];
  for (const dir of dirs) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // A read-only Immich mount, or a host path that is not present yet, stays as configured.
    }
  }
}

export function cliAvailable(command: string): boolean {
  if (command.includes("/") || command.includes("\\")) {
    try {
      accessSync(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  return (process.env.PATH || "")
    .split(path.delimiter)
    .some((dir) => {
      try {
        accessSync(path.join(dir, command), constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

function splitList(value: string | undefined, fallback: string): string[] {
  const raw = value?.trim() || fallback;
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}
