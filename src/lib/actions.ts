import { baseName } from "./format";
import { AppError } from "./errors";
import { ignoreKey, memberIds, pruneIgnoredEntries } from "./ignore";
import { assetsForOriginalPaths } from "./immich-asset-index";
import { endRejoin, reportRejoin, tryBeginRejoin } from "./immich-rejoin-progress";
import { attachAssets, originalPathsForGroups } from "./immich-join";
import { resolveImmichScanRoots } from "./immich-mounts";
import { resolveImmichPathMap } from "./immich-path-map";
import {
  addAssetsToAlbum,
  fetchImmichAssetStatistics,
  fetchImmichUser,
  pingImmich,
  removeAssetsFromAlbum,
  fetchImmichStack,
  removeAssetsFromStack,
  stackAssets,
  trashAssets,
  updateStackPrimary,
  type ImmichUser,
} from "./immich";
import { groupHasImmichArchived } from "./immich-archived";
import { forgetImmichStacks, rememberImmichStack } from "./immich-stack-sync";
import {
  assignSelectionToStack,
  detachAssetsFromStack,
  dropCompleteStacks,
  orderGroupItems,
  groupIsOneCompleteStack,
  looseAssetIds,
  replaceGroup,
  setStackPrimary,
  stackIdsInGroup,
} from "./immich-stacks";
import { extractStoredGroup, mergeStoredGroups } from "./merge-groups";
import { pickPrimaryIndex } from "./primary";
import { DEFAULT_RESULTS_GROUP_SORT, sortResultGroups, type ResultsGroupSortId } from "./results-sort";
import { cancelThumbJobs, cancelThumbWork } from "./thumb-sessions";
import { resolveInside } from "./path-jail";
import { loadConfig } from "./config";
import {
  creditImmichTrash,
  loadIgnored,
  loadResults,
  loadSettings,
  resultsMembership,
  updateIgnored,
  updateResults,
} from "./store";
import { moveToTrash, resolveMediaFile } from "./trash";
import type {
  ClientGroup,
  ClientItem,
  IgnoredGroupCard,
  ResultsPreviewResponse,
  ResultsResponse,
  SectionId,
  StoredGroup,
  StoredItem,
  StoredResults,
  UnmatchedFile,
} from "./types";

export async function resultsView(section: SectionId): Promise<ResultsResponse> {
  const [results, ignored] = await Promise.all([loadResults(section), loadIgnored(section)]);
  if (!results) {
    return {
      section,
      scanned: false,
      finishedAt: null,
      durationMs: null,
      error: null,
      warning: null,
      hiddenIgnored: 0,
      unmatched: 0,
      groups: [],
    };
  }
  const hiddenKeys = new Set(ignored.map((entry) => entry.key));
  let hiddenIgnored = 0;
  let unmatched = 0;
  const groups: ClientGroup[] = [];
  const source = section === "immich" ? dropCompleteStacks(results.groups) : results.groups;
  for (const group of source) {
    if (hiddenKeys.has(ignoreKey(memberIds(section, group.items)))) {
      hiddenIgnored += 1;
      continue;
    }
    const storedItems = section === "immich" ? orderGroupItems(group.items) : group.items;
    const primary = pickPrimaryIndex(storedItems);
    const items = storedItems.map((item, index) => toClient(section, item, index === primary));
    unmatched += items.filter((item) => !item.matched).length;
    groups.push({ groupId: group.groupId, items });
  }
  return {
    section,
    scanned: true,
    finishedAt: results.finishedAt,
    durationMs: results.durationMs ?? null,
    error: results.error,
    warning: results.warning,
    hiddenIgnored,
    unmatched,
    groups,
  };
}

export async function resultsPreview(
  section: SectionId,
  sortId: ResultsGroupSortId = DEFAULT_RESULTS_GROUP_SORT,
  limit = 10,
): Promise<ResultsPreviewResponse> {
  const [results, ignored] = await Promise.all([loadResults(section), loadIgnored(section)]);
  const empty: ResultsPreviewResponse = {
    section,
    scanned: false,
    finishedAt: null,
    durationMs: null,
    error: null,
    hiddenIgnored: 0,
    groupCount: 0,
    groups: [],
  };
  if (!results) return empty;
  const hiddenKeys = new Set(ignored.map((entry) => entry.key));
  let hiddenIgnored = 0;
  const visible: StoredGroup[] = [];
  const source = section === "immich" ? dropCompleteStacks(results.groups) : results.groups;
  for (const group of source) {
    if (hiddenKeys.has(ignoreKey(memberIds(section, group.items)))) {
      hiddenIgnored += 1;
      continue;
    }
    visible.push(group);
  }
  const cap = Math.min(10, Math.max(1, Math.floor(limit)));
  const groups = sortResultGroups(visible, sortId)
    .slice(0, cap)
    .map((group) => {
      const poster = group.items[pickPrimaryIndex(group.items)] ?? group.items[0];
      return {
        groupId: group.groupId,
        itemCount: group.items.length,
        immichArchived: groupHasImmichArchived(section, group),
        posterPath: poster?.path ?? "",
        posterAssetId: poster?.assetId ?? null,
        posterName: poster ? baseName(poster.path) : "",
      };
    });
  return {
    section,
    scanned: true,
    finishedAt: results.finishedAt,
    durationMs: results.durationMs ?? null,
    error: results.error,
    hiddenIgnored,
    groupCount: visible.length,
    groups,
  };
}

export async function ignoredGroupsView(section: SectionId): Promise<IgnoredGroupCard[]> {
  const [results, ignored] = await Promise.all([loadResults(section), loadIgnored(section)]);
  if (!results) return ignored.map((entry) => ({ entry, group: null }));
  const entries = await updateIgnored(section, (current) => {
    const pruned = pruneIgnoredEntries(section, current, results.groups);
    return pruned.length === current.length ? current : pruned;
  });
  const byKey = new Map<string, StoredGroup>();
  for (const group of results.groups) {
    byKey.set(ignoreKey(memberIds(section, group.items)), group);
  }
  return entries.map((entry) => {
    const stored = byKey.get(entry.key);
    if (!stored) return { entry, group: null };
    const storedItems = section === "immich" ? orderGroupItems(stored.items) : stored.items;
    const primary = pickPrimaryIndex(storedItems);
    const items = storedItems.map((item, index) => toClient(section, item, index === primary));
    return { entry, group: { groupId: stored.groupId, items } };
  });
}

function toClient(section: SectionId, item: StoredItem, isPrimary: boolean): ClientItem {
  return {
    ...item,
    stackId: item.stackId ?? null,
    stackPrimary: Boolean(item.stackPrimary),
    name: baseName(item.path),
    matched: section === "server" ? true : Boolean(item.assetId),
    isPrimary,
  };
}

export async function extractResultGroup(section: SectionId, groupId: string, paths: string[]): Promise<string> {
  let createdId = "";
  const saved = await updateResults(section, (current) => {
    if (!current) throw new AppError("There is no scan to act on", 404);
    const extracted = extractStoredGroup(current.groups, groupId, paths);
    createdId = extracted.groupId;
    return { ...current, groups: extracted.groups };
  });
  if (!saved) throw new AppError("There is no scan to act on", 404);
  await updateIgnored(section, (entries) => pruneIgnoredEntries(section, entries, saved.groups));
  return createdId;
}

export async function mergeResultGroups(section: SectionId, sourceGroupId: string, targetGroupId: string): Promise<void> {
  const saved = await updateResults(section, (current) => {
    if (!current) throw new AppError("There is no scan to act on", 404);
    return { ...current, groups: mergeStoredGroups(current.groups, sourceGroupId, targetGroupId) };
  });
  if (!saved) throw new AppError("There is no scan to act on", 404);
  await updateIgnored(section, (entries) => pruneIgnoredEntries(section, entries, saved.groups));
}

export async function ignoreGroup(section: SectionId, groupId: string): Promise<void> {
  const results = await requireResults(section);
  const group = requireGroup(results, groupId);
  const key = ignoreKey(memberIds(section, group.items));
  await updateIgnored(section, (entries) => {
    if (entries.some((entry) => entry.key === key)) return entries;
    return [
      ...entries,
      {
        key,
        ignoredAt: new Date().toISOString(),
        groupId,
        labels: group.items.map((item) => baseName(item.path)),
      },
    ];
  });
  await cancelThumbJobs(section, group.items.map((item) => item.path));
}

export async function restoreIgnored(section: SectionId, key: string): Promise<void> {
  await updateIgnored(section, (entries) => entries.filter((entry) => entry.key !== key));
}

export async function trashServerGroup(groupId: string, keepPath: string): Promise<number> {
  const results = await requireResults("server");
  const group = requireGroup(results, groupId);
  const keep = await realResultPath("server", keepPath, group);
  const victims = group.items.map((item) => item.path).filter((itemPath) => itemPath !== keep);
  return commitServerTrash(victims);
}

export async function trashServerItems(groupId: string, victimPaths: string[]): Promise<number> {
  const results = await requireResults("server");
  const group = requireGroup(results, groupId);
  if (victimPaths.length === 0) throw new AppError("Choose a file to trash");
  const victims: string[] = [];
  for (const victimPath of victimPaths) victims.push(await realResultPath("server", victimPath, group));
  const unique = [...new Set(victims)];
  if (unique.length >= group.items.length) throw new AppError("Keep at least one file in this group");
  return commitServerTrash(unique);
}

export async function stackImmichGroup(groupId: string, primaryId: string, assetIds?: string[]): Promise<void> {
  const settings = await loadSettings();
  requireImmich(settings.immich.baseUrl, settings.immich.apiKey);
  const results = await requireResults("immich");
  const group = requireGroup(results, groupId);
  const ids = matchedIds(group);
  const chosen = assetIds?.length ? ids.filter((id) => assetIds.includes(id) || id === primaryId) : ids;
  if (!chosen.includes(primaryId)) throw new AppError("The primary file is not a matched Immich asset");
  const ordered = [primaryId, ...chosen.filter((id) => id !== primaryId)];
  if (ordered.length < 2) throw new AppError("Stacking needs at least two matched assets");
  const created = await stackAssets(settings.immich.baseUrl, settings.immich.apiKey, ordered);
  if (!created.id) throw new AppError("Immich did not return the stack");
  rememberImmichStack(created);
  const previousStacks = stackIdsInGroup(group).filter((id) => id !== created.id);
  if (previousStacks.length > 0) forgetImmichStacks(previousStacks);
  await saveImmichStackGroup(groupId, (fresh) => assignSelectionToStack(fresh, ordered, created.id, created.primaryAssetId || primaryId));
}

/** Add loose files in a group onto its single existing Immich stack. */
export async function addToImmichStack(groupId: string, assetIds?: string[]): Promise<void> {
  const settings = await loadSettings();
  requireImmich(settings.immich.baseUrl, settings.immich.apiKey);
  const results = await requireResults("immich");
  const group = requireGroup(results, groupId);
  const stacks = stackIdsInGroup(group);
  if (stacks.length === 0) throw new AppError("This group has no Immich stack to join");
  if (stacks.length > 1) throw new AppError("This group has more than one stack. Merge them first");
  const stackId = stacks[0];
  const primary =
    group.items.find((item) => item.stackId === stackId && item.stackPrimary && item.assetId)?.assetId ??
    group.items.find((item) => item.stackId === stackId && item.assetId)?.assetId;
  if (!primary) throw new AppError("The stack has no matched assets");
  const loose = new Set(looseAssetIds(group));
  const adding = [...new Set(assetIds?.length ? assetIds : [...loose])];
  if (adding.length === 0) throw new AppError("Choose a file to add to the stack");
  const matched = new Set(matchedIds(group));
  if (adding.some((id) => !matched.has(id))) throw new AppError("That file is not a matched Immich asset");
  if (adding.some((id) => !loose.has(id))) throw new AppError("That file is already in a stack");
  const members = group.items.flatMap((item) => (item.assetId && item.stackId === stackId ? [item.assetId] : []));
  const created = await stackAssets(settings.immich.baseUrl, settings.immich.apiKey, [
    primary,
    ...members.filter((id) => id !== primary),
    ...adding,
  ]);
  if (!created.id) throw new AppError("Immich did not return the stack");
  rememberImmichStack(created);
  if (created.id !== stackId) forgetImmichStacks([stackId]);
  const selected = [...new Set([primary, ...members, ...adding])];
  await saveImmichStackGroup(groupId, (fresh) =>
    assignSelectionToStack(fresh, selected, created.id, created.primaryAssetId || primary),
  );
}

/** Merge every stack in a group into one, with `primaryId` as the cover. */
export async function mergeImmichStacks(groupId: string, primaryId: string): Promise<void> {
  const settings = await loadSettings();
  requireImmich(settings.immich.baseUrl, settings.immich.apiKey);
  const results = await requireResults("immich");
  const group = requireGroup(results, groupId);
  const stacks = stackIdsInGroup(group);
  if (stacks.length < 2) throw new AppError("This group needs at least two stacks to merge");
  if (!matchedIds(group).includes(primaryId)) throw new AppError("The primary file is not a matched Immich asset");
  const stacked = group.items.flatMap((item) => (item.assetId && item.stackId ? [item.assetId] : []));
  if (!stacked.includes(primaryId)) throw new AppError("The primary file is not in a stack");
  const ordered = [primaryId, ...stacked.filter((id) => id !== primaryId)];
  const created = await stackAssets(settings.immich.baseUrl, settings.immich.apiKey, ordered);
  if (!created.id) throw new AppError("Immich did not return the stack");
  rememberImmichStack(created);
  forgetImmichStacks(stacks.filter((id) => id !== created.id));
  await saveImmichStackGroup(groupId, (fresh) =>
    assignSelectionToStack(fresh, ordered, created.id, created.primaryAssetId || primaryId),
  );
}

/** Pull selected members out of one stack so they stay in the group as loose files. */
export async function removeFromImmichStack(groupId: string, assetIds: string[]): Promise<void> {
  const settings = await loadSettings();
  requireImmich(settings.immich.baseUrl, settings.immich.apiKey);
  const results = await requireResults("immich");
  const group = requireGroup(results, groupId);
  const unique = [...new Set(assetIds)];
  if (unique.length === 0) throw new AppError("Choose a file to remove from the stack");
  const matched = new Set(matchedIds(group));
  if (unique.some((id) => !matched.has(id))) throw new AppError("That file is not a matched Immich asset");
  const chosen = group.items.filter((item) => item.assetId && unique.includes(item.assetId));
  const stackIds = [...new Set(chosen.flatMap((item) => (item.stackId ? [item.stackId] : [])))];
  if (chosen.length !== unique.length || stackIds.length !== 1 || chosen.some((item) => !item.stackId)) {
    throw new AppError("Select files from the same stack");
  }
  const stackId = stackIds[0];
  await removeAssetsFromStack(settings.immich.baseUrl, settings.immich.apiKey, stackId, unique);
  forgetImmichStacks([stackId]);
  const fresh = await fetchImmichStack(settings.immich.baseUrl, settings.immich.apiKey, stackId);
  if (fresh) rememberImmichStack(fresh);
  await saveImmichStackGroup(groupId, (current) =>
    detachAssetsFromStack(
      current,
      unique,
      fresh ? { id: fresh.id, primaryAssetId: fresh.primaryAssetId, assetIds: fresh.assets.map((asset) => asset.id) } : null,
    ),
  );
}

/** Make one member the cover of its Immich stack. */
export async function makeImmichStackPrimary(groupId: string, assetId: string): Promise<void> {
  const settings = await loadSettings();
  requireImmich(settings.immich.baseUrl, settings.immich.apiKey);
  const results = await requireResults("immich");
  const group = requireGroup(results, groupId);
  const item = group.items.find((entry) => entry.assetId === assetId);
  if (!item?.assetId || !item.stackId) throw new AppError("That file is not in a stack");
  const stackId = item.stackId;
  await updateStackPrimary(settings.immich.baseUrl, settings.immich.apiKey, stackId, assetId);
  forgetImmichStacks([stackId]);
  await saveImmichStackGroup(groupId, (fresh) => setStackPrimary(fresh, stackId, assetId));
}

async function saveImmichStackGroup(groupId: string, apply: (group: StoredGroup) => StoredGroup): Promise<void> {
  await updateResults("immich", (current) => {
    if (!current) return current;
    const fresh = current.groups.find((group) => group.groupId === groupId);
    if (!fresh) return current;
    const next = apply(fresh);
    const kept = groupIsOneCompleteStack(next) ? null : next;
    return { ...current, groups: replaceGroup(current.groups, groupId, kept) };
  });
}

export async function trashImmichGroup(groupId: string, keepId: string): Promise<number> {
  const settings = await loadSettings();
  requireImmich(settings.immich.baseUrl, settings.immich.apiKey);
  const results = await requireResults("immich");
  const group = requireGroup(results, groupId);
  const ids = matchedIds(group);
  if (!ids.includes(keepId)) throw new AppError("The kept file is not a matched Immich asset");
  return commitImmichTrash(settings.immich.baseUrl, settings.immich.apiKey, ids.filter((id) => id !== keepId));
}

export async function mutateImmichAlbumAsset(albumId: string, assetId: string, action: "add" | "remove"): Promise<void> {
  const settings = await loadSettings();
  requireImmich(settings.immich.baseUrl, settings.immich.apiKey);
  const membership = await resultsMembership("immich");
  if (!membership.found || !membership.assetIds.has(assetId)) {
    throw new AppError("That asset is not in the current results", 404);
  }
  const creds = { baseUrl: settings.immich.baseUrl, apiKey: settings.immich.apiKey };
  if (action === "add") await addAssetsToAlbum(creds.baseUrl, creds.apiKey, albumId, [assetId]);
  else await removeAssetsFromAlbum(creds.baseUrl, creds.apiKey, albumId, [assetId]);
}

export async function trashImmichItems(groupId: string, victimIds: string[]): Promise<number> {
  const settings = await loadSettings();
  requireImmich(settings.immich.baseUrl, settings.immich.apiKey);
  const results = await requireResults("immich");
  const group = requireGroup(results, groupId);
  const ids = matchedIds(group);
  const unique = [...new Set(victimIds)];
  if (unique.length === 0) throw new AppError("Choose a file to trash");
  if (unique.some((id) => !ids.includes(id))) throw new AppError("That file is not a matched Immich asset");
  if (unique.length >= ids.length) throw new AppError("Keep at least one file in this group");
  return commitImmichTrash(settings.immich.baseUrl, settings.immich.apiKey, unique);
}

export async function unmatchedImmichReport(): Promise<{
  finishedAt: string | null;
  pathMap: { from: string; to: string }[];
  items: UnmatchedFile[];
}> {
  const settings = await loadSettings();
  const view = await resultsView("immich");
  let pathMap = settings.immich.pathMap;
  try {
    const creds =
      settings.immich.baseUrl && settings.immich.apiKey
        ? { baseUrl: settings.immich.baseUrl, apiKey: settings.immich.apiKey }
        : undefined;
    pathMap = await resolveImmichPathMap(creds);
  } catch {
    // Keep the map saved with settings when Immich cannot be reached.
  }
  const items: UnmatchedFile[] = [];
  for (const group of view.groups) {
    for (const item of group.items) {
      if (item.matched) continue;
      items.push({
        name: item.name,
        path: item.path,
        originalPath: item.originalPath,
        reason: item.originalPath ? "no-asset" : "no-map",
        groupId: group.groupId,
        isImage: item.isImage,
      });
    }
  }
  items.sort((a, b) => a.path.localeCompare(b.path));
  return { finishedAt: view.finishedAt, pathMap, items };
}

export async function rejoinImmich(): Promise<number> {
  if (!tryBeginRejoin()) throw new AppError("Matching is already running", 409);
  try {
    const settings = await loadSettings();
    requireImmich(settings.immich.baseUrl, settings.immich.apiKey);
    const creds = { baseUrl: settings.immich.baseUrl, apiKey: settings.immich.apiKey };
    reportRejoin({ percent: 2, label: "Loading results", detail: "Reading saved Immich scan from disk…" });
    const results = await requireResults("immich");
    const itemCount = results.groups.reduce((sum, group) => sum + group.items.length, 0);
    reportRejoin({
      percent: 6,
      label: "Loading results",
      detail: `Loaded ${results.groups.length} groups (${itemCount.toLocaleString()} files)`,
    });
    let maps = settings.immich.pathMap;
    if (maps.length === 0) {
      reportRejoin({ percent: 8, label: "Path map", detail: "Asking Immich for library paths (can be slow on network mounts)…" });
      maps = await resolveImmichPathMap(creds);
    } else {
      reportRejoin({ percent: 9, label: "Path map", detail: "Using path map from settings" });
    }
    const paths = originalPathsForGroups(results.groups, maps);
    reportRejoin({
      percent: 11,
      label: "Asset index",
      detail: "Opening local Immich path cache…",
    });
    const assets = await assetsForOriginalPaths(
      settings.immich.baseUrl,
      settings.immich.apiKey,
      paths,
      settings.immich.scan.includeImages,
      settings.immich.scan.parallelism,
      {
        onIndex: ({ pathCount, missing, searchNames }) => {
          reportRejoin({
            percent: 12,
            label: "Matching Immich library",
            detail:
              missing === 0
                ? `All ${pathCount.toLocaleString()} paths already in the local cache`
                : `${missing.toLocaleString()} paths to resolve (${searchNames.toLocaleString()} Immich name lookups)`,
            indeterminate: missing > 0 && searchNames === 0,
          });
        },
        onSearch: (done, total, fileName) => {
          const slice = total > 0 ? done / total : 1;
          reportRejoin({
            percent: Math.round(12 + slice * 78),
            label: "Matching Immich library",
            detail: total > 0 ? `Searching by file name (${done}/${total}): ${fileName}` : `Searching: ${fileName}`,
          });
        },
        onLibraryFallback: () => {
          reportRejoin({
            percent: 45,
            label: "Matching Immich library",
            detail: "Name search unavailable — reading the full library…",
            indeterminate: true,
          });
        },
      },
    );
    reportRejoin({ percent: 92, label: "Saving", detail: "Updating linked assets in scan results…", indeterminate: false });
    const saved = await updateResults("immich", (current) => {
      const base = current ?? results;
      return { ...base, warning: null, groups: attachAssets(base.groups, assets, maps) };
    });
    reportRejoin({ percent: 100, label: "Done", detail: "Match finished" });
    return (saved?.groups ?? []).reduce((sum, group) => sum + group.items.filter((item) => item.assetId).length, 0);
  } finally {
    endRejoin();
  }
}

export type ImmichConnectionInfo = { baseUrl: string; user: ImmichUser };

export async function immichConnectionInfo(baseUrl = "", apiKey = ""): Promise<ImmichConnectionInfo> {
  const settings = await loadSettings();
  const url = baseUrl.trim() || settings.immich.baseUrl;
  const key = apiKey.trim() || settings.immich.apiKey;
  requireImmich(url, key);
  await pingImmich(url, key);
  const user = await fetchImmichUser(url, key);
  return { baseUrl: url, user };
}

export async function testImmichConnection(baseUrl: string, apiKey: string): Promise<ImmichConnectionInfo> {
  return immichConnectionInfo(baseUrl, apiKey);
}

export async function savedImmichStatus(): Promise<
  | { connected: true; baseUrl: string; user: ImmichUser; scanRoots: string[]; libraryTotal: number | null }
  | { connected: false; baseUrl?: string; error?: string }
> {
  const settings = await loadSettings();
  if (!settings.immich.baseUrl || !settings.immich.apiKey) {
    return { connected: false };
  }
  const creds = { baseUrl: settings.immich.baseUrl, apiKey: settings.immich.apiKey };
  try {
    const info = await immichConnectionInfo();
    const [scanRoots, libraryTotal] = await Promise.all([
      resolveImmichScanRoots(creds),
      fetchImmichAssetStatistics(creds.baseUrl, creds.apiKey)
        .then((stats) => stats.total)
        .catch(() => null),
    ]);
    return { connected: true, ...info, scanRoots, libraryTotal };
  } catch (err) {
    return {
      connected: false,
      baseUrl: settings.immich.baseUrl,
      error: err instanceof Error ? err.message : "Could not reach Immich",
    };
  }
}

export async function realResultPath(section: SectionId, candidate: string, group?: StoredGroup): Promise<string> {
  if (group) {
    if (!group.items.some((item) => item.path === candidate)) throw new AppError("That file is not in the current results");
  } else {
    const membership = await resultsMembership(section);
    if (!membership.found) throw new AppError("There is no scan to act on", 404);
    if (!membership.paths.has(candidate)) throw new AppError("That file is not in the current results");
  }
  const config = loadConfig();
  const settings = section === "immich" ? await loadSettings() : null;
  const roots =
    section === "server"
      ? config.mediaRoots
      : await resolveImmichScanRoots({ baseUrl: settings?.immich.baseUrl ?? "", apiKey: settings?.immich.apiKey ?? "" });
  return section === "server" ? resolveMediaFile(roots, candidate) : resolveInside(roots, candidate);
}

async function requireResults(section: SectionId): Promise<StoredResults> {
  const results = await loadResults(section);
  if (!results) throw new AppError("There is no scan to act on", 404);
  return results;
}

function requireGroup(results: StoredResults, groupId: string): StoredGroup {
  const group = results.groups.find((item) => item.groupId === groupId);
  if (!group) throw new AppError("That group is not in the current results", 404);
  return group;
}

function matchedIds(group: StoredGroup): string[] {
  return group.items.flatMap((item) => (item.assetId ? [item.assetId] : []));
}

function requireImmich(baseUrl: string, apiKey: string): void {
  if (!baseUrl || !apiKey) throw new AppError("Save the Immich URL and API key first");
}

async function commitServerTrash(victims: string[]): Promise<number> {
  if (victims.length === 0) throw new AppError("Nothing else in this group can be trashed");
  cancelThumbWork(victims);
  const moved = await moveToTrash(victims);
  await updateResults("server", (current) => {
    if (!current) return current;
    return dropItems(current, (item) => victims.includes(item.path));
  });
  return moved;
}

async function commitImmichTrash(baseUrl: string, apiKey: string, victims: string[]): Promise<number> {
  if (victims.length === 0) throw new AppError("Nothing else in this group can be trashed");
  const snapshot = await loadResults("immich");
  const victimPaths =
    snapshot?.groups
      .flatMap((group) => group.items)
      .filter((item) => item.assetId !== null && victims.includes(item.assetId))
      .map((item) => item.path) ?? [];
  await cancelThumbJobs("immich", victimPaths);
  await trashAssets(baseUrl, apiKey, victims);
  let credited: { id: string; bytes: number }[] = [];
  await updateResults("immich", (current) => {
    if (!current) return current;
    const victimItems = current.groups
      .flatMap((group) => group.items)
      .filter((item) => item.assetId !== null && victims.includes(item.assetId));
    credited = victimItems.map((item) => ({
      id: item.assetId || `path:${item.path}`,
      bytes: Math.max(0, item.sizeBytes),
    }));
    return dropItems(current, (item) => item.assetId !== null && victims.includes(item.assetId));
  });
  if (credited.length > 0) await creditImmichTrash(credited);
  return victims.length;
}

function dropItems(results: StoredResults, remove: (item: StoredItem) => boolean): StoredResults {
  return {
    ...results,
    groups: results.groups
      .map((group) => ({ ...group, items: group.items.filter((item) => !remove(item)) }))
      .filter((group) => group.items.length >= 2),
  };
}
