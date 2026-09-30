import path from "node:path";
import { runPool } from "./concurrency";
import { loadConfig } from "./config";
import { exclusive, readJson, writeJson } from "./json-file";
import { listArchivedImmichAssetIds, listImmichAssets, searchImmichAssetsByFileName, type ImmichAsset } from "./immich";

type AssetCacheEntry = string | { id: string; stackId: string | null; stackPrimary: boolean; isArchived?: boolean };
type AssetCache = { byPath: Record<string, AssetCacheEntry> };

function cacheAsset(asset: ImmichAsset): AssetCacheEntry {
  return {
    id: asset.id,
    stackId: asset.stackId ?? null,
    stackPrimary: Boolean(asset.stackPrimary),
    isArchived: Boolean(asset.isArchived),
  };
}

function cacheHasId(entry: AssetCacheEntry | undefined): boolean {
  if (!entry) return false;
  return typeof entry === "string" ? entry.length > 0 : Boolean(entry.id);
}

function cacheEntryId(entry: AssetCacheEntry): string {
  return typeof entry === "string" ? entry : entry.id;
}

export function pruneTrashedFromAssetCache(cache: AssetCache, trashedIds: ReadonlySet<string>): AssetCache {
  if (trashedIds.size === 0) return cache;
  const byPath: Record<string, AssetCacheEntry> = {};
  for (const [filePath, entry] of Object.entries(cache.byPath)) {
    if (trashedIds.has(cacheEntryId(entry))) continue;
    byPath[filePath] = entry;
  }
  return { byPath };
}

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

export type StackCacheMember = {
  assetId: string;
  originalPath: string | null;
  stackId: string | null;
  stackPrimary: boolean;
};

/** Point cached assets at a stack the user just created, merged, or left. */
export function applyStackMembershipToCache(cache: AssetCache, members: StackCacheMember[]): AssetCache {
  const byId = new Map<string, string[]>();
  for (const [filePath, entry] of Object.entries(cache.byPath)) {
    const id = typeof entry === "string" ? entry : entry.id;
    const paths = byId.get(id) ?? [];
    paths.push(filePath);
    byId.set(id, paths);
  }
  const byPath = { ...cache.byPath };
  for (const member of members) {
    const paths = new Set(byId.get(member.assetId) ?? []);
    if (member.originalPath) paths.add(slash(member.originalPath));
    if (paths.size === 0) continue;
    for (const filePath of paths) {
      const prior = byPath[filePath];
      const priorArchived = prior && typeof prior !== "string" ? Boolean(prior.isArchived) : false;
      byPath[filePath] = {
        id: member.assetId,
        stackId: member.stackId,
        stackPrimary: member.stackPrimary,
        isArchived: priorArchived,
      };
    }
  }
  return { byPath };
}

export async function writeStackMembership(members: StackCacheMember[]): Promise<void> {
  if (members.length === 0) return;
  await exclusive(async () => {
    const cache = await readJson<AssetCache>(cacheFile(), { byPath: {} });
    await writeJson(cacheFile(), applyStackMembershipToCache(cache, members));
  });
}

export function applyArchivedIdsToCache(cache: AssetCache, archivedIds: ReadonlySet<string>): AssetCache {
  const byPath: Record<string, AssetCacheEntry> = {};
  for (const [filePath, entry] of Object.entries(cache.byPath)) {
    const id = cacheEntryId(entry);
    const isArchived = archivedIds.has(id);
    if (typeof entry === "string") {
      byPath[filePath] = isArchived
        ? { id: entry, stackId: null, stackPrimary: false, isArchived: true }
        : entry;
    } else {
      byPath[filePath] = { ...entry, isArchived };
    }
  }
  return { byPath };
}

export function assetsFromCache(cache: AssetCache, originalPaths: string[]): ImmichAsset[] {
  const assets: ImmichAsset[] = [];
  for (const originalPath of originalPaths) {
    const entry = cache.byPath[slash(originalPath)];
    if (!entry) continue;
    if (typeof entry === "string") assets.push({ id: entry, originalPath });
    else {
      assets.push({
        id: entry.id,
        originalPath,
        stackId: entry.stackId,
        stackPrimary: entry.stackPrimary,
        isArchived: Boolean(entry.isArchived),
      });
    }
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
  parallelism: number,
  progress?: AssetLookupProgress,
  trashedIds?: ReadonlySet<string>,
): Promise<ImmichAsset[]> {
  let cache = await readJson<AssetCache>(cacheFile(), { byPath: {} });
  if (trashedIds && trashedIds.size > 0) {
    cache = pruneTrashedFromAssetCache(cache, trashedIds);
    await writeJson(cacheFile(), cache);
  }
  const missing: string[] = [];
  for (const originalPath of originalPaths) {
    const entry = cache.byPath[slash(originalPath)];
    if (!cacheHasId(entry)) missing.push(originalPath);
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
    const searches = [...byName.entries()];
    const searchTotal = searches.length;
    let searchDone = 0;
    await runPool(searches, parallelism, async ([name, paths]) => {
      if (filenameSearchFailed) return;
      searchDone += 1;
      progress?.onSearch?.(searchDone, searchTotal, name);
      try {
        const found = await searchImmichAssetsByFileName(baseUrl, apiKey, name, includeImages);
        const wanted = new Set(paths.map((entry) => slash(entry)));
        for (const asset of found) {
          if (trashedIds?.has(asset.id)) continue;
          const key = slash(asset.originalPath);
          if (wanted.has(key)) cache.byPath[key] = cacheAsset(asset);
        }
      } catch {
        filenameSearchFailed = true;
      }
    });
    if (filenameSearchFailed) {
      progress?.onLibraryFallback?.();
      const all = await listImmichAssets(baseUrl, apiKey, includeImages);
      for (const asset of all) {
        if (trashedIds?.has(asset.id)) continue;
        cache.byPath[slash(asset.originalPath)] = cacheAsset(asset);
      }
    }
    await writeJson(cacheFile(), cache);
  }
  try {
    cache = applyArchivedIdsToCache(cache, await listArchivedImmichAssetIds(baseUrl, apiKey));
    await writeJson(cacheFile(), cache);
  } catch {
    // Archive sync is best-effort; matching still returns cached ids.
  }
  return assetsFromCache(cache, originalPaths);
}
