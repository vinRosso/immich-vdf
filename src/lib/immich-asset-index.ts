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

export function assetsFromCache(cache: AssetCache, originalPaths: string[]): ImmichAsset[] {
  const assets: ImmichAsset[] = [];
  for (const originalPath of originalPaths) {
    const id = cache.byPath[slash(originalPath)];
    if (id) assets.push({ id, originalPath });
  }
  return assets;
}

/** Resolve only the original paths from the current duplicate groups, using a local cache. */
export async function assetsForOriginalPaths(
  baseUrl: string,
  apiKey: string,
  originalPaths: string[],
  includeImages: boolean,
): Promise<ImmichAsset[]> {
  const cache = await readJson<AssetCache>(cacheFile(), { byPath: {} });
  const missing: string[] = [];
  for (const originalPath of originalPaths) {
    if (!cache.byPath[slash(originalPath)]) missing.push(originalPath);
  }
  if (missing.length > 0) {
    const byName = new Map<string, string[]>();
    for (const originalPath of missing) {
      const name = fileName(originalPath);
      const group = byName.get(name) ?? [];
      group.push(originalPath);
      byName.set(name, group);
    }
    let filenameSearchFailed = false;
    for (const [name, paths] of byName) {
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
      const all = await listImmichAssets(baseUrl, apiKey, includeImages);
      for (const asset of all) cache.byPath[slash(asset.originalPath)] = asset.id;
    }
    await writeJson(cacheFile(), cache);
  }
  return assetsFromCache(cache, originalPaths);
}
