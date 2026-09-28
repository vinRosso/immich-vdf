import { readdirSync } from "node:fs";
import path from "node:path";
import { loadConfig, type AppConfig, type ImmichBind } from "./config";
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

/** Upload library mount inside vdf-web (`${IMMICH_PATH}` → `/immich`). */
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

function joinHostSuffix(hostPath: string, suffix: string): string {
  const parts = suffix.split("/").filter(Boolean);
  const joiner = hostPath.includes("\\") ? path.win32 : path.posix;
  return parts.reduce((current, part) => joiner.join(current, part), hostPath);
}

/** Replace a host folder with the bind-mount target when Immich overlays that container path. */
export function rewriteHostPathWithBinds(
  hostPath: string,
  uploadMount: string,
  uploadChildren: string[],
  binds: ImmichBind[],
): string {
  if (binds.length === 0) return hostPath;
  const mount = normalizeRoot(uploadMount);
  const host = normalizeRoot(hostPath);
  const mountKey = mount.toLowerCase();
  const hostKey = host.toLowerCase();
  if (hostKey !== mountKey && !hostKey.startsWith(`${mountKey}/`)) return hostPath;
  const suffix = host.slice(mount.length);
  const container = `${immichMediaPrefix(uploadChildren)}${suffix}`.replace(/\/{2,}/g, "/");
  const ranked = [...binds].sort((a, b) => b.containerPath.length - a.containerPath.length);
  const containerKey = container.toLowerCase();
  for (const bind of ranked) {
    const from = bind.containerPath.replace(/\/+$/, "");
    const fromKey = from.toLowerCase();
    if (containerKey === fromKey) return bind.hostPath;
    if (containerKey.startsWith(`${fromKey}/`)) return joinHostSuffix(bind.hostPath, container.slice(from.length));
  }
  return hostPath;
}

/** Host paths allowed for Immich scans (upload mount, env roots, mapped library import paths, bind targets). */
export async function resolveImmichScanRoots(credentials?: ImmichCredentials): Promise<string[]> {
  const config = loadConfig();
  const roots = new Set<string>([config.immichLibrary, ...config.immichScanRoots, ...config.immichBinds.map((bind) => bind.hostPath)]);
  const url = credentials?.baseUrl.trim() ?? "";
  const key = credentials?.apiKey ?? "";
  if (url && key) {
    try {
      const children = uploadMountChildren(config.immichLibrary);
      for (const importPath of await listImmichLibraryImportPaths(url, key)) {
        const mapped = mapImmichImportPathToHost(importPath, config.immichLibrary, children, config);
        if (mapped) roots.add(rewriteHostPathWithBinds(mapped, config.immichLibrary, children, config.immichBinds));
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
