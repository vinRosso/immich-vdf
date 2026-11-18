import { readdirSync } from "node:fs";
import path from "node:path";
import { loadConfig, type AppConfig } from "./config";
import { immichKeyHas, listImmichLibraryImportPaths } from "./immich";
import { hostPathForContainerMount } from "./volume-binds";

/** Immich media root inside the Immich container (`UPLOAD_LOCATION` is mounted at `/data`). */
export const IMMICH_UPLOAD_PREFIX = "/data";

const UPLOAD_ROOT_DIRS = ["library", "upload", "thumbs", "encoded-video", "profile", "backups"];

/** `/data` when the mount is UPLOAD_LOCATION, `/data/library` when the mount is already the library folder. */
export function immichMediaPrefix(children: string[]): string {
  if (children.length === 0) return IMMICH_UPLOAD_PREFIX;
  const names = new Set(children.map((name) => name.toLowerCase()));
  if (UPLOAD_ROOT_DIRS.some((name) => names.has(name))) return IMMICH_UPLOAD_PREFIX;
  return `${IMMICH_UPLOAD_PREFIX}/library`;
}

export type ImmichCredentials = { baseUrl: string; apiKey: string };

/** Upload library mount inside immich-vdf (`${IMMICH_PATH}` → `/immich`). */
export function immichUploadMount(config: AppConfig = loadConfig()): string {
  return config.immichLibrary;
}

function normalizeRoot(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/, "");
}

function dedupeRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = normalizeRoot(root).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Scan roots from env when the Immich API is not available. */
export function immichScanRootsFromConfig(config: AppConfig = loadConfig()): string[] {
  return dedupeRoots(config.immichScanRoots);
}

function uploadMountChildren(uploadMount: string): string[] {
  try {
    return readdirSync(uploadMount, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function joinMountSuffix(uploadMount: string, suffix: string): string {
  const parts = suffix.split("/").filter(Boolean);
  const joiner = uploadMount.includes("\\") ? path.win32 : path.posix;
  return parts.reduce((current, part) => joiner.join(current, part), uploadMount);
}

/**
 * Map an Immich library `importPath` (container path under `/data/...`) to the host upload mount.
 * External libraries only match when the same path is listed in `IMMICH_SCAN_ROOTS`.
 */
export function mapImmichImportPathToHost(
  importPath: string,
  uploadMount: string,
  uploadChildren: string[],
  config: AppConfig = loadConfig(),
): string | null {
  const bound = hostPathForContainerMount(importPath, config);
  if (bound) return bound;
  const mediaPrefix = immichMediaPrefix(uploadChildren).replace(/\\/g, "/");
  const normalized = importPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const prefix = mediaPrefix.replace(/\/+$/, "");
  const lower = normalized.toLowerCase();
  const prefixLower = prefix.toLowerCase();
  if (lower === prefixLower) return remapHostPathForVolumeBind(uploadMount, uploadMount, uploadChildren, config);
  if (lower.startsWith(`${prefixLower}/`)) {
    const suffix = normalized.slice(prefix.length).replace(/^\//, "");
    const mapped = suffix ? joinMountSuffix(uploadMount, suffix) : uploadMount;
    return remapHostPathForVolumeBind(mapped, uploadMount, uploadChildren, config);
  }
  const configured = config.immichScanRoots.find(
    (root) => normalizeRoot(root).toLowerCase() === normalizeRoot(importPath).toLowerCase(),
  );
  if (configured) {
    return hostPathForContainerMount(configured, config) ?? configured;
  }
  return null;
}

/** After default upload mapping, apply `VOLUME_BINDS` (dev host overrides). */
export function remapHostPathForVolumeBind(
  hostPath: string,
  uploadMount: string,
  uploadChildren: string[],
  config: AppConfig = loadConfig(),
): string {
  const direct = hostPathForContainerMount(hostPath, config);
  if (direct) return direct;
  const uploadNorm = uploadMount.replace(/\\/g, "/").replace(/\/+$/, "");
  const hostNorm = hostPath.replace(/\\/g, "/");
  if (!hostNorm.toLowerCase().startsWith(uploadNorm.toLowerCase())) return hostPath;
  const suffix = hostNorm.slice(uploadNorm.length).replace(/^\//, "");
  if (!suffix) return hostPath;
  const containerPath = `${immichMediaPrefix(uploadChildren)}/${suffix}`;
  return hostPathForContainerMount(containerPath, config) ?? hostPath;
}

const scanRootsCache = new Map<string, { at: number; roots: string[] }>();
const scanRootsFlights = new Map<string, Promise<string[]>>();
const SCAN_ROOTS_TTL_MS = 60_000;

/**
 * Host paths allowed for Immich scans (upload mount, env roots, mapped library import paths).
 * An expired answer is returned at once while one background request refreshes it, so file requests
 * never queue behind the Immich library list.
 */
export async function resolveImmichScanRoots(credentials?: ImmichCredentials): Promise<string[]> {
  const config = loadConfig();
  const cacheKey = `${normalizeRoot(config.immichLibrary)}\0${credentials?.baseUrl.trim() ?? ""}`;
  const hit = scanRootsCache.get(cacheKey);
  if (hit) {
    if (Date.now() - hit.at >= SCAN_ROOTS_TTL_MS) void refreshScanRoots(cacheKey, config, credentials).catch(() => undefined);
    return hit.roots;
  }
  return refreshScanRoots(cacheKey, config, credentials);
}

function refreshScanRoots(cacheKey: string, config: AppConfig, credentials?: ImmichCredentials): Promise<string[]> {
  let flight = scanRootsFlights.get(cacheKey);
  if (!flight) {
    flight = computeScanRoots(config, credentials)
      .then((roots) => {
        scanRootsCache.set(cacheKey, { at: Date.now(), roots });
        return roots;
      })
      .finally(() => scanRootsFlights.delete(cacheKey));
    scanRootsFlights.set(cacheKey, flight);
  }
  return flight;
}

async function computeScanRoots(config: AppConfig, credentials?: ImmichCredentials): Promise<string[]> {
  const roots = new Set<string>([
    config.immichLibrary,
    ...config.immichScanRoots,
    ...config.volumeBinds.map((bind) => bind.host),
  ]);
  const url = credentials?.baseUrl.trim() ?? "";
  const key = credentials?.apiKey ?? "";
  if (url && key && (await immichKeyHas(url, key, "library.read").catch(() => true))) {
    try {
      const children = uploadMountChildren(config.immichLibrary);
      for (const importPath of await listImmichLibraryImportPaths(url, key)) {
        const mapped = mapImmichImportPathToHost(importPath, config.immichLibrary, children, config);
        if (mapped) roots.add(remapHostPathForVolumeBind(mapped, config.immichLibrary, children, config));
      }
    } catch {
      // Fall back to compose/env roots.
    }
  }
  return dedupeRoots([...roots]);
}

/** External scan roots (not the upload mount at `/immich`). */
export function externalRootsFromScanRoots(scanRoots: string[], config: AppConfig = loadConfig()): string[] {
  const uploadKey = normalizeRoot(immichUploadMount(config)).toLowerCase();
  return scanRoots.filter((root) => normalizeRoot(root).toLowerCase() !== uploadKey);
}
