export type ResultMediaMeta = {
  isImage: boolean;
  durationSeconds: number;
  width: number;
  height: number;
};

export type ResultsMembership = {
  assetIds: Set<string>;
  paths: Set<string>;
  mediaByPath: Map<string, ResultMediaMeta>;
};

type MembershipGroup = {
  items: {
    path: string;
    assetId?: string | null;
    isImage?: boolean;
    durationSeconds?: number;
    width?: number;
    height?: number;
  }[];
};

/** Asset ids and file paths present in a saved scan, for thumbnail checks that must not re-read the file. */
export function membershipFromResults(results: { groups: MembershipGroup[] } | null): ResultsMembership {
  const assetIds = new Set<string>();
  const paths = new Set<string>();
  const mediaByPath = new Map<string, ResultMediaMeta>();
  for (const group of results?.groups ?? []) {
    for (const item of group.items) {
      if (item.path) {
        paths.add(item.path);
        mediaByPath.set(item.path, {
          isImage: Boolean(item.isImage),
          durationSeconds: Number.isFinite(item.durationSeconds) ? Number(item.durationSeconds) : 0,
          width: Number.isFinite(item.width) ? Number(item.width) : 0,
          height: Number.isFinite(item.height) ? Number(item.height) : 0,
        });
      }
      if (item.assetId) assetIds.add(item.assetId);
    }
  }
  return { assetIds, paths, mediaByPath };
}
