export type ResultsMembership = {
  assetIds: Set<string>;
  paths: Set<string>;
};

type MembershipGroup = {
  items: { path: string; assetId?: string | null }[];
};

/** Asset ids and file paths present in a saved scan, for thumbnail checks that must not re-read the file. */
export function membershipFromResults(results: { groups: MembershipGroup[] } | null): ResultsMembership {
  const assetIds = new Set<string>();
  const paths = new Set<string>();
  for (const group of results?.groups ?? []) {
    for (const item of group.items) {
      if (item.path) paths.add(item.path);
      if (item.assetId) assetIds.add(item.assetId);
    }
  }
  return { assetIds, paths };
}
