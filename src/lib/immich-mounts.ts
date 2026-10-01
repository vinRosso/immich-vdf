import { readdirSync } from "node:fs";
import path from "node:path";
import { loadConfig, type AppConfig } from "./config";
import { listImmichLibraryImportPaths } from "./immich";

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
  const mediaPrefix = immichMediaPrefix(uploadChildren).replace(/\\/g, "/");
  const normalized = importPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const prefix = mediaPrefix.replace(/\/+$/, "");
  const lower = normalized.toLowerCase();
  const prefixLower = prefix.toLowerCase();
  if (lower === prefixLower) return uploadMount;
  if (lower.startsWith(`${prefixLower}/`)) {
    const suffix = normalized.slice(prefix.length).replace(/^\//, "");
    return suffix ? joinMountSuffix(uploadMount, suffix) : uploadMount;
  }
  const configured = config.immichScanRoots.find(
    (root) => normalizeRoot(root).toLowerCase() === normalizeRoot(importPath).toLowerCase(),
  );
  return configured ?? null;
}

const scanRootsCache = new Map<string, { at: number; roots: string[] }>();
const SCAN_ROOTS_TTL_MS = 60_000;

/** Host paths allowed for Immich scans (upload mount, env roots, mapped library import paths). */
export async function resolveImmichScanRoots(credentials?: ImmichCredentials): Promise<string[]> {
  const config = loadConfig();
  const cacheKey = `${normalizeRoot(config.immichLibrary)}\0${credentials?.baseUrl.trim() ?? ""}`;
  const hit = scanRootsCache.get(cacheKey);
  if (hit && Date.now() - hit.at < SCAN_ROOTS_TTL_MS) return hit.roots;
  const roots = new Set<string>([config.immichLibrary, ...config.immichScanRoots]);
  const url = credentials?.baseUrl.trim() ?? "";
  const key = credentials?.apiKey ?? "";
  if (url && key) {
    try {
      const children = uploadMountChildren(config.immichLibrary);
      for (const importPath of await listImmichLibraryImportPaths(url, key)) {
        const mapped = mapImmichImportPathToHost(importPath, config.immichLibrary, children, config);
        if (mapped) roots.add(mapped);
      }
    } catch {
      // Fall back to compose/env roots.
    }
  }
  const resolved = dedupeRoots([...roots]);
  scanRootsCache.set(cacheKey, { at: Date.now(), roots: resolved });
  return resolved;
}

/** External scan roots (not the upload mount at `/immich`). */
export function externalRootsFromScanRoots(scanRoots: string[], config: AppConfig = loadConfig()): string[] {
  const uploadKey = normalizeRoot(immichUploadMount(config)).toLowerCase();
  return scanRoots.filter((root) => normalizeRoot(root).toLowerCase() !== uploadKey);
}
