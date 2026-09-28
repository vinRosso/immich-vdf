import path from "node:path";
import { loadConfig } from "./config";
import { readJson, writeJson } from "./json-file";
import { listImmichAssets, searchImmichAssetsByFileName, type ImmichAsset } from "./immich";

type AssetCache = { byPath: Record<string, string> };

function cacheFile(): string {
  return path.join(loadConfig().dataDir, "immich-asset-index.json");
}

function slash(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function fileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

/**
 * Upload extensions Immich rewrites when it builds a storage-template path.
 * The key is the extension written on disk; the values are what `originalFileName` can still say.
 * See `getTemplatePath` in Immich's storage-template service.
 */
const PATH_EXTENSION_ORIGINS: Record<string, readonly string[]> = {
  jpg: ["jpeg", "jpe"],
  tiff: ["tif"],
  "3gp": ["3gpp"],
  mpg: ["mpeg", "mpe"],
  mts: ["m2ts", "m2t"],
};

function withExtensionOrigins(name: string): string[] {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return [name];
  const stem = name.slice(0, dot);
  const origins = PATH_EXTENSION_ORIGINS[name.slice(dot + 1).toLowerCase()] ?? [];
  return [name, ...origins.map((origin) => `${stem}.${origin}`)];
}

/**
 * Names to ask Immich for. A storage template keeps `originalFileName` and, when the
 * destination already exists, writes `name+1.ext`, then `+2`, and so on. The `+N` sits
 * immediately before the extension. Matching still requires the full original path.
 */
export function assetSearchNames(filePath: string): string[] {
  const stored = fileName(filePath);
  const candidates = [stored];
  const collision = stored.match(/^(.*\S)\+\d+(\.[^.]+)$/);
  if (collision?.[1] && collision[2]) candidates.push(`${collision[1]}${collision[2]}`);

  const names: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    for (const variant of withExtensionOrigins(candidate)) {
      const key = variant.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(variant);
    }
  }
  return names;
}

export function assetsFromCache(cache: AssetCache, originalPaths: string[]): ImmichAsset[] {
  const assets: ImmichAsset[] = [];
  for (const originalPath of originalPaths) {
    const id = cache.byPath[slash(originalPath)];
    if (id) assets.push({ id, originalPath });
  }
  return assets;
}

export type AssetLookupProgress = {
  onIndex?: (info: { pathCount: number; missing: number; searchNames: number }) => void;
  onSearch?: (done: number, total: number, fileName: string) => void;
  onLibraryFallback?: () => void;
};

/** Resolve only the original paths from the current duplicate groups, using a local cache. */
export async function assetsForOriginalPaths(
  baseUrl: string,
  apiKey: string,
  originalPaths: string[],
  includeImages: boolean,
  progress?: AssetLookupProgress,
): Promise<ImmichAsset[]> {
  const cache = await readJson<AssetCache>(cacheFile(), { byPath: {} });
  const missing: string[] = [];
  for (const originalPath of originalPaths) {
    if (!cache.byPath[slash(originalPath)]) missing.push(originalPath);
  }
  const byName = new Map<string, string[]>();
  for (const originalPath of missing) {
    for (const name of assetSearchNames(originalPath)) {
      const group = byName.get(name) ?? [];
      group.push(originalPath);
      byName.set(name, group);
    }
  }
  progress?.onIndex?.({ pathCount: originalPaths.length, missing: missing.length, searchNames: byName.size });
  if (missing.length > 0) {
    let filenameSearchFailed = false;
    const searchTotal = byName.size;
    let searchDone = 0;
    for (const [name, paths] of byName) {
      searchDone += 1;
      progress?.onSearch?.(searchDone, searchTotal, name);
      try {
        const found = await searchImmichAssetsByFileName(baseUrl, apiKey, name, includeImages);
        const wanted = new Set(paths.map((entry) => slash(entry)));
        for (const asset of found) {
          const key = slash(asset.originalPath);
          if (wanted.has(key)) cache.byPath[key] = asset.id;
        }
      } catch {
        filenameSearchFailed = true;
        break;
      }
    }
    if (filenameSearchFailed) {
      progress?.onLibraryFallback?.();
      const all = await listImmichAssets(baseUrl, apiKey, includeImages);
      for (const asset of all) cache.byPath[slash(asset.originalPath)] = asset.id;
    }
    await writeJson(cacheFile(), cache);
  }
  return assetsFromCache(cache, originalPaths);
}
