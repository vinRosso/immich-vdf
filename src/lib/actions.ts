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
  fetchImmichUser,
  pingImmich,
  removeAssetsFromAlbum,
  stackAssets,
  trashAssets,
  type ImmichUser,
} from "./immich";
import { pickPrimaryIndex } from "./primary";
import { cancelThumbJobs, cancelThumbWork } from "./thumb-sessions";
import { resolveInside } from "./path-jail";
import { loadConfig } from "./config";
import { loadIgnored, loadResults, loadSettings, saveIgnored, saveResults } from "./store";
import { moveToTrash, resolveMediaFile } from "./trash";
import type {
  ClientGroup,
  ClientItem,
  IgnoredGroupCard,
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
  for (const group of results.groups) {
    if (hiddenKeys.has(ignoreKey(memberIds(section, group.items)))) {
      hiddenIgnored += 1;
      continue;
    }
    const primary = pickPrimaryIndex(group.items);
    const items = group.items.map((item, index) => toClient(section, item, index === primary));
    unmatched += items.filter((item) => !item.matched).length;
    groups.push({ groupId: group.groupId, items });
  }
  return {
    section,
    scanned: true,
    finishedAt: results.finishedAt,
    error: results.error,
    warning: results.warning,
    hiddenIgnored,
    unmatched,
    groups,
  };
}

export async function ignoredGroupsView(section: SectionId): Promise<IgnoredGroupCard[]> {
  const [results, ignored] = await Promise.all([loadResults(section), loadIgnored(section)]);
  if (!results) return ignored.map((entry) => ({ entry, group: null }));
  const entries = pruneIgnoredEntries(section, ignored, results.groups);
  if (entries.length !== ignored.length) await saveIgnored(section, entries);
  const byKey = new Map<string, StoredGroup>();
  for (const group of results.groups) {
    byKey.set(ignoreKey(memberIds(section, group.items)), group);
  }
  return entries.map((entry) => {
    const stored = byKey.get(entry.key);
    if (!stored) return { entry, group: null };
    const primary = pickPrimaryIndex(stored.items);
    const items = stored.items.map((item, index) => toClient(section, item, index === primary));
    return { entry, group: { groupId: stored.groupId, items } };
  });
}

function toClient(section: SectionId, item: StoredItem, isPrimary: boolean): ClientItem {
  return {
    ...item,
    name: baseName(item.path),
    matched: section === "server" ? true : Boolean(item.assetId),
    isPrimary,
  };
}

export async function ignoreGroup(section: SectionId, groupId: string): Promise<void> {
  const results = await requireResults(section);
  const group = requireGroup(results, groupId);
  const key = ignoreKey(memberIds(section, group.items));
  const entries = await loadIgnored(section);
  if (entries.some((entry) => entry.key === key)) return;
  entries.push({
    key,
    ignoredAt: new Date().toISOString(),
    groupId,
    labels: group.items.map((item) => baseName(item.path)),
  });
  await saveIgnored(section, entries);
  await cancelThumbJobs(section, group.items.map((item) => item.path));
}

export async function restoreIgnored(section: SectionId, key: string): Promise<void> {
  const entries = await loadIgnored(section);
  await saveIgnored(
    section,
    entries.filter((entry) => entry.key !== key),
  );
}

export async function trashServerGroup(groupId: string, keepPath: string): Promise<number> {
  const results = await requireResults("server");
  const group = requireGroup(results, groupId);
  const keep = await realResultPath("server", keepPath, group);
  const victims = group.items.map((item) => item.path).filter((itemPath) => itemPath !== keep);
  return commitServerTrash(results, victims);
}

export async function trashServerItems(groupId: string, victimPaths: string[]): Promise<number> {
  const results = await requireResults("server");
  const group = requireGroup(results, groupId);
  if (victimPaths.length === 0) throw new AppError("Choose a file to trash");
  const victims: string[] = [];
  for (const victimPath of victimPaths) victims.push(await realResultPath("server", victimPath, group));
  const unique = [...new Set(victims)];
  if (unique.length >= group.items.length) throw new AppError("Keep at least one file in this group");
  return commitServerTrash(results, unique);
}

export async function stackImmichGroup(groupId: string, primaryId: string): Promise<void> {
  const settings = await loadSettings();
  requireImmich(settings.immich.baseUrl, settings.immich.apiKey);
  const results = await requireResults("immich");
  const group = requireGroup(results, groupId);
  const ids = matchedIds(group);
  if (!ids.includes(primaryId)) throw new AppError("The primary file is not a matched Immich asset");
  const ordered = [primaryId, ...ids.filter((id) => id !== primaryId)];
  if (ordered.length < 2) throw new AppError("Stacking needs at least two matched assets");
  await stackAssets(settings.immich.baseUrl, settings.immich.apiKey, ordered);
  await saveResults("immich", {
    ...results,
    groups: results.groups.filter((item) => item.groupId !== groupId),
  });
}

export async function trashImmichGroup(groupId: string, keepId: string): Promise<number> {
  const settings = await loadSettings();
  requireImmich(settings.immich.baseUrl, settings.immich.apiKey);
  const results = await requireResults("immich");
  const group = requireGroup(results, groupId);
  const ids = matchedIds(group);
  if (!ids.includes(keepId)) throw new AppError("The kept file is not a matched Immich asset");
  return commitImmichTrash(settings.immich.baseUrl, settings.immich.apiKey, results, ids.filter((id) => id !== keepId));
}

export async function mutateImmichAlbumAsset(albumId: string, assetId: string, action: "add" | "remove"): Promise<void> {
  const settings = await loadSettings();
  requireImmich(settings.immich.baseUrl, settings.immich.apiKey);
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
  return commitImmichTrash(settings.immich.baseUrl, settings.immich.apiKey, results, unique);
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
    const groups = attachAssets(results.groups, assets, maps);
    await saveResults("immich", { ...results, warning: null, groups });
    reportRejoin({ percent: 100, label: "Done", detail: "Match finished" });
    return groups.reduce((sum, group) => sum + group.items.filter((item) => item.assetId).length, 0);
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
  | { connected: true; baseUrl: string; user: ImmichUser; scanRoots: string[] }
  | { connected: false; baseUrl?: string; error?: string }
> {
  const settings = await loadSettings();
  if (!settings.immich.baseUrl || !settings.immich.apiKey) {
    return { connected: false };
  }
  const creds = { baseUrl: settings.immich.baseUrl, apiKey: settings.immich.apiKey };
  try {
    const info = await immichConnectionInfo();
    const scanRoots = await resolveImmichScanRoots(creds);
    return { connected: true, ...info, scanRoots };
  } catch (err) {
    return {
      connected: false,
      baseUrl: settings.immich.baseUrl,
      error: err instanceof Error ? err.message : "Could not reach Immich",
    };
  }
}

export async function realResultPath(section: SectionId, candidate: string, group?: StoredGroup): Promise<string> {
  const results = await requireResults(section);
  const source = group ?? results.groups.find((item) => item.items.some((entry) => entry.path === candidate));
  const known = new Set((source ? source.items : results.groups.flatMap((item) => item.items)).map((item) => item.path));
  if (!known.has(candidate)) throw new AppError("That file is not in the current results");
  const config = loadConfig();
  const settings = await loadSettings();
  const roots =
    section === "server"
      ? config.mediaRoots
      : await resolveImmichScanRoots({ baseUrl: settings.immich.baseUrl, apiKey: settings.immich.apiKey });
  const real = section === "server" ? await resolveMediaFile(roots, candidate) : await resolveInside(roots, candidate);
  if (!known.has(real) && !known.has(candidate)) throw new AppError("That file is not in the current results");
  return real;
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

async function commitServerTrash(results: StoredResults, victims: string[]): Promise<number> {
  if (victims.length === 0) throw new AppError("Nothing else in this group can be trashed");
  cancelThumbWork(victims);
  const moved = await moveToTrash(victims);
  await saveResults("server", dropItems(results, (item) => victims.includes(item.path)));
  return moved;
}

async function commitImmichTrash(baseUrl: string, apiKey: string, results: StoredResults, victims: string[]): Promise<number> {
  if (victims.length === 0) throw new AppError("Nothing else in this group can be trashed");
  const victimPaths = results.groups
    .flatMap((group) => group.items)
    .filter((item) => item.assetId && victims.includes(item.assetId))
    .map((item) => item.path);
  await cancelThumbJobs("immich", victimPaths);
  await trashAssets(baseUrl, apiKey, victims);
  await saveResults("immich", dropItems(results, (item) => item.assetId !== null && victims.includes(item.assetId)));
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
