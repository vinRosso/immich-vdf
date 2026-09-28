import type { ImmichAlbum } from "@/lib/immich";

export type GroupAlbumMap = Record<string, ImmichAlbum[]>;

export function groupAssetIds(items: { assetId?: string | null }[]): string[] {
  return items.map((item) => item.assetId).filter((id): id is string => Boolean(id));
}

export function albumSetsMismatch(assetIds: string[], byAsset: GroupAlbumMap): boolean {
  if (assetIds.length < 2) return false;
  const keys = assetIds.map((id) =>
    (byAsset[id] ?? [])
      .map((album) => album.id)
      .sort()
      .join("\0"),
  );
  return keys.some((key) => key !== keys[0]);
}

export function albumName(byAsset: GroupAlbumMap, albumId: string): string {
  for (const albums of Object.values(byAsset)) {
    const hit = albums.find((album) => album.id === albumId);
    if (hit) return hit.name;
  }
  return "Album";
}

/** Albums on this asset that at least one peer does not share (offer remove). */
export function removableAlbumIds(assetId: string, groupAssetIds: string[], byAsset: GroupAlbumMap): string[] {
  const own = new Set((byAsset[assetId] ?? []).map((album) => album.id));
  const removable: string[] = [];
  for (const albumId of own) {
    for (const peerId of groupAssetIds) {
      if (peerId === assetId) continue;
      const peerHas = (byAsset[peerId] ?? []).some((album) => album.id === albumId);
      if (!peerHas) {
        removable.push(albumId);
        break;
      }
    }
  }
  return removable;
}

/** Albums any peer has that this asset lacks (offer add). */
export function missingAlbumIds(assetId: string, groupAssetIds: string[], byAsset: GroupAlbumMap): string[] {
  const own = new Set((byAsset[assetId] ?? []).map((album) => album.id));
  const missing = new Set<string>();
  for (const peerId of groupAssetIds) {
    if (peerId === assetId) continue;
    for (const album of byAsset[peerId] ?? []) {
      if (!own.has(album.id)) missing.add(album.id);
    }
  }
  return [...missing];
}
