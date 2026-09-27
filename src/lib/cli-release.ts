import { spawn } from "node:child_process";
import { cliAvailable } from "./config";

const RELEASES_URL = "https://api.github.com/repos/0x90d/videoduplicatefinder/releases?per_page=30";
const CACHE_MS = 30 * 60 * 1000;

type Release = { tag_name?: string };

let cache: { at: number; version: string | null } | null = null;

export function semverParts(value: string | null | undefined): [number, number, number] | null {
  const match = value?.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareRelease(installed: string | null, latest: string | null): "current" | "update" | "unknown" {
  const current = semverParts(installed);
  const next = semverParts(latest);
  if (!current || !next) return "unknown";
  for (let index = 0; index < 3; index += 1) {
    if (current[index] < next[index]) return "update";
    if (current[index] > next[index]) return "current";
  }
  return "current";
}

export function newestStableVersion(releases: Release[]): string | null {
  let best: [number, number, number] | null = null;
  let label: string | null = null;
  for (const release of releases) {
    const tag = release.tag_name ?? "";
    if (!/^v\d+\.\d+\.\d+$/.test(tag)) continue;
    const parts = semverParts(tag);
    if (!parts) continue;
    if (!best || compareRelease(best.join("."), parts.join(".")) === "update") {
      best = parts;
      label = parts.join(".");
    }
  }
  return label;
}

export function releaseAssetName(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === "win32" && arch === "x64") return "CLI-win-x64.zip";
  if (platform === "win32" && arch === "arm64") return "CLI-win-arm64.zip";
  if (platform === "linux" && arch === "x64") return "CLI-linux-x64.tar.gz";
  if (platform === "linux" && arch === "arm64") return "CLI-linux-arm64.tar.gz";
  if (platform === "darwin" && arch === "x64") return "CLI-osx-x64.tar.gz";
  if (platform === "darwin" && arch === "arm64") return "CLI-osx-arm64.tar.gz";
  return null;
}

export function assertSafeArchiveEntries(entries: string[]): void {
  for (const entry of entries) {
    const name = entry.trim();
    if (!name) continue;
    if (name.includes("..") || name.startsWith("/") || name.startsWith("\\") || /^[a-zA-Z]:/.test(name)) {
      throw new Error("Release archive has an unsafe path");
    }
  }
}

export function releaseDownloadUrl(tagVersion: string, assetName: string, assets: { name?: string; browser_download_url?: string }[]): string {
  const asset = assets.find((entry) => entry.name === assetName);
  const raw = asset?.browser_download_url;
  if (!raw) throw new Error(`Release v${tagVersion} has no ${assetName}`);
  const url = new URL(raw);
  const expected = `/0x90d/videoduplicatefinder/releases/download/v${tagVersion}/${assetName}`;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== expected) {
    throw new Error("Release download URL is not the official asset");
  }
  return url.toString();
}

export async function readCliVersion(command: string): Promise<string | null> {
  if (!cliAvailable(command)) return null;
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 8000);
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const parts = semverParts(output);
      resolve(parts ? parts.join(".") : null);
    });
  });
}

export async function latestStableVersion(): Promise<string | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.version;
  const version = await fetchLatestStableVersion();
  cache = { at: Date.now(), version };
  return version;
}

export function clearReleaseCache(): void {
  cache = null;
}

async function fetchLatestStableVersion(): Promise<string | null> {
  const response = await fetch(RELEASES_URL, {
    headers: { accept: "application/vnd.github+json", "user-agent": "vdf-web" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  const releases = (await response.json()) as Release[];
  return newestStableVersion(Array.isArray(releases) ? releases : []);
}
