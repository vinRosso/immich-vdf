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

/** Upload mount plus external library paths from Immich (or env fallback). */
export async function resolveImmichScanRoots(credentials?: ImmichCredentials): Promise<string[]> {
  const config = loadConfig();
  const roots = new Set<string>([config.immichLibrary]);
  const url = credentials?.baseUrl.trim() ?? "";
  const key = credentials?.apiKey ?? "";
  if (url && key) {
    try {
      for (const importPath of await listImmichLibraryImportPaths(url, key)) {
        roots.add(importPath);
      }
      return dedupeRoots([...roots]);
    } catch {
      // Fall back to compose/env roots.
    }
  }
  return immichScanRootsFromConfig(config);
}

/** External scan roots (not the upload mount at `/immich`). */
export function externalRootsFromScanRoots(scanRoots: string[], config: AppConfig = loadConfig()): string[] {
  const uploadKey = normalizeRoot(immichUploadMount(config)).toLowerCase();
  return scanRoots.filter((root) => normalizeRoot(root).toLowerCase() !== uploadKey);
}
