import type { PathMapEntry, StoredGroup, StoredItem } from "./types";

function slash(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function cliPathToOriginal(cliPath: string, maps: PathMapEntry[]): string | null {
  const normalized = cliPath.replace(/\\/g, "/");
  const ordered = [...maps]
    .filter((entry) => entry.from.trim() && entry.to.trim())
    .sort((a, b) => slash(b.to).length - slash(a.to).length);
  for (const entry of ordered) {
    const to = slash(entry.to);
    const from = slash(entry.from);
    if (normalized === to || normalized.startsWith(`${to}/`)) {
      return `${from}${normalized.slice(to.length)}`;
    }
  }
  return null;
}

export function matchAsset(
  originalPath: string | null,
  assets: { id: string; originalPath: string }[],
): { id: string; originalPath: string } | null {
  if (!originalPath) return null;
  const want = slash(originalPath);
  return assets.find((asset) => slash(asset.originalPath) === want) ?? null;
}

export function attachAssets(
  groups: StoredGroup[],
  assets: { id: string; originalPath: string }[],
  maps: PathMapEntry[],
): StoredGroup[] {
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => decorate(item, assets, maps)),
  }));
}

function decorate(
  item: StoredItem,
  assets: { id: string; originalPath: string }[],
  maps: PathMapEntry[],
): StoredItem {
  const originalPath = cliPathToOriginal(item.path, maps);
  const asset = matchAsset(originalPath, assets);
  return {
    ...item,
    originalPath,
    assetId: asset?.id ?? null,
  };
}
