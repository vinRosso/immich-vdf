import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeArchiveEntries, clearReleaseCache, latestStableVersion, readCliVersion, releaseAssetName, releaseDownloadUrl } from "./cli-release";
import { loadConfig } from "./config";
import { AppError } from "./errors";
import { getScan } from "./scan";

const MAX_BYTES = 200 * 1024 * 1024;

type ReleaseAsset = { name?: string; browser_download_url?: string };
type Release = { tag_name?: string; assets?: ReleaseAsset[] };

export async function updateCli(): Promise<{ version: string }> {
  if (getScan().running) throw new AppError("Wait for the scan to finish before updating vdf-cli", 409);
  const assetName = releaseAssetName(process.platform, process.arch);
  if (!assetName) throw new AppError("No official vdf-cli build for this platform");
  const latest = await latestStableVersion();
  if (!latest) throw new AppError("Could not read the latest vdf-cli release");
  const release = await fetchRelease(latest);
  const downloadUrl = officialDownload(latest, assetName, release.assets ?? []);
  const config = loadConfig();
  const work = path.join(config.dataDir, "cli", "incoming");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const archive = path.join(work, assetName);
  try {
    await download(downloadUrl, archive);
    const extract = path.join(work, "extract");
    await mkdir(extract);
    await extractArchive(archive, extract);
    const binary = await findBinary(extract);
    if (!binary) throw new AppError("The release archive does not contain vdf-cli");
    const dest = path.join(config.dataDir, "cli", "releases", latest);
    await rm(dest, { recursive: true, force: true });
    await cp(path.dirname(binary), dest, { recursive: true });
    const installed = path.join(dest, path.basename(binary));
    if (process.platform !== "win32") await chmod(installed, 0o755);
    const version = await readCliVersion(installed);
    if (version !== latest) throw new AppError(`Updated vdf-cli reported ${version ?? "no version"}, expected ${latest}`);
    const active = path.join(config.dataDir, "cli", "active.json");
    await writeFile(active, JSON.stringify({ path: installed, version }));
    clearReleaseCache();
    return { version };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function fetchRelease(version: string): Promise<Release> {
  const response = await fetch(`https://api.github.com/repos/0x90d/videoduplicatefinder/releases/tags/v${version}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "vdf-web" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new AppError(`Could not read release v${version}`);
  return (await response.json()) as Release;
}

function officialDownload(version: string, assetName: string, assets: ReleaseAsset[]): string {
  try {
    return releaseDownloadUrl(version, assetName, assets);
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : "Could not find the release");
  }
}

async function download(url: string, file: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), redirect: "follow" });
  if (!response.ok || !response.body) throw new AppError(`Download failed (${response.status})`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_BYTES) throw new AppError("Release download is larger than expected");
  const stream = createWriteStream(file);
  const reader = response.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BYTES) throw new AppError("Release download is larger than expected");
      if (!stream.write(Buffer.from(value))) await new Promise<void>((resolve) => stream.once("drain", () => resolve()));
    }
  } catch (error) {
    stream.destroy();
    throw error;
  }
  stream.end();
  await new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", () => reject(new AppError("Could not save the release")));
  });
}

async function extractArchive(archive: string, dest: string): Promise<void> {
  const listing = await runTar(["-tf", archive]);
  try {
    assertSafeArchiveEntries(listing.split(/\r?\n/));
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : "Release archive has an unsafe path");
  }
  await runTar(["-xf", archive, "-C", dest]);
}

function runTar(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", () => reject(new AppError("tar is not available to unpack the release")));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new AppError(stderr.trim() || "Could not unpack the release"));
    });
  });
}

async function findBinary(dir: string, depth = 0): Promise<string | null> {
  if (depth > 4) return null;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "vdf-cli" || entry.name === "vdf-cli.exe") return path.join(dir, entry.name);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findBinary(path.join(dir, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}
