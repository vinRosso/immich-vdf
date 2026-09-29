import type { ImmichAsset } from "./immich";
import type { PathMapEntry, StoredGroup, StoredItem } from "./types";

function slash(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function normalizePath(value: string): string {
  return slash(value.replace(/\\/g, "/"));
}

function orderedMaps(maps: PathMapEntry[]): PathMapEntry[] {
  return [...maps]
    .filter((entry) => entry.from.trim() && entry.to.trim())
    .sort((a, b) => slash(b.to).length - slash(a.to).length);
}

function orderedFromMaps(maps: PathMapEntry[]): PathMapEntry[] {
  return [...maps]
    .filter((entry) => entry.from.trim() && entry.to.trim())
    .sort((a, b) => slash(b.from).length - slash(a.from).length);
}

export function cliPathToOriginal(cliPath: string, maps: PathMapEntry[]): string | null {
  const normalized = cliPath.replace(/\\/g, "/");
  for (const entry of orderedMaps(maps)) {
    const to = slash(entry.to);
    const from = slash(entry.from);
    if (normalized === to || normalized.startsWith(`${to}/`)) {
      return `${from}${normalized.slice(to.length)}`;
    }
  }
  return null;
}

export function originalPathToCli(originalPath: string, maps: PathMapEntry[]): string | null {
  const normalized = normalizePath(originalPath);
  for (const entry of orderedFromMaps(maps)) {
    const from = slash(entry.from);
    const to = slash(entry.to);
    if (normalized === from || normalized.startsWith(`${from}/`)) {
      return `${to}${normalized.slice(from.length)}`;
    }
  }
  return null;
}

export function matchAsset(originalPath: string | null, assets: ImmichAsset[]): ImmichAsset | null {
  if (!originalPath) return null;
  const want = slash(originalPath);
  return assets.find((asset) => slash(asset.originalPath) === want) ?? null;
}

function buildCliIndex(assets: ImmichAsset[], maps: PathMapEntry[]): Map<string, ImmichAsset> {
  const index = new Map<string, ImmichAsset>();
  for (const asset of assets) {
    const original = normalizePath(asset.originalPath);
    index.set(original, asset);
    const cli = originalPathToCli(asset.originalPath, maps);
    if (cli) index.set(normalizePath(cli), asset);
  }
  return index;
}

export function originalPathsForGroups(groups: StoredGroup[], maps: PathMapEntry[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const item of group.items) {
      const original = cliPathToOriginal(item.path, maps);
      if (!original) continue;
      const key = slash(original);
      if (seen.has(key)) continue;
      seen.add(key);
      paths.push(original);
    }
  }
  return paths;
}

export function attachAssets(groups: StoredGroup[], assets: ImmichAsset[], maps: PathMapEntry[]): StoredGroup[] {
  const byCliPath = buildCliIndex(assets, maps);
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => decorate(item, byCliPath, assets, maps)),
  }));
}

function itemInImmichTrash(
  item: StoredItem,
  trashedIds: ReadonlySet<string>,
  trashedPaths: ReadonlySet<string>,
  maps: PathMapEntry[],
): boolean {
  if (item.assetId && trashedIds.has(item.assetId)) return true;
  const candidates = [item.originalPath, cliPathToOriginal(item.path, maps), item.path].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return candidates.some((value) => trashedPaths.has(normalizePath(value)));
}

/** Remove items linked to Immich-trashed assets; drop groups that no longer have duplicates. */
export function dropImmichTrashedFromGroups(
  groups: StoredGroup[],
  trashedIds: ReadonlySet<string>,
  maps: PathMapEntry[] = [],
  trashedPaths: ReadonlySet<string> = new Set(),
): StoredGroup[] {
  if (trashedIds.size === 0 && trashedPaths.size === 0) return groups;
  const kept: StoredGroup[] = [];
  for (const group of groups) {
    const items = group.items.filter((item) => !itemInImmichTrash(item, trashedIds, trashedPaths, maps));
    if (items.length >= 2) kept.push({ ...group, items });
  }
  return kept;
}

function decorate(
  item: StoredItem,
  byCliPath: Map<string, ImmichAsset>,
  assets: ImmichAsset[],
  maps: PathMapEntry[],
): StoredItem {
  const cliKey = normalizePath(item.path);
  const indexed = byCliPath.get(cliKey);
  const originalPath = indexed ? slash(indexed.originalPath) : cliPathToOriginal(item.path, maps);
  const asset = indexed ?? matchAsset(originalPath, assets);
  return {
    ...item,
    originalPath,
    assetId: asset?.id ?? null,
    stackId: asset?.stackId ?? null,
    stackPrimary: Boolean(asset?.stackPrimary),
  };
}
