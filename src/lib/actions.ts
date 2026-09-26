import { baseName } from "./format";
import { AppError } from "./errors";
import { ignoreKey, memberIds } from "./ignore";
import { attachAssets } from "./immich-join";
import { listImmichAssets, pingImmich, stackAssets, trashAssets } from "./immich";
import { pickPrimaryIndex } from "./primary";
import { resolveInside } from "./path-jail";
import { loadConfig } from "./config";
import { loadIgnored, loadResults, loadSettings, saveIgnored, saveResults } from "./store";
import { moveToTrash } from "./trash";
import type { ClientGroup, ClientItem, ResultsResponse, SectionId, StoredGroup, StoredItem, StoredResults } from "./types";

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
  if (victims.length === 0) throw new AppError("Nothing else in this group can be trashed");
  const moved = await moveToTrash(victims);
  await saveResults("server", dropItems(results, (item) => victims.includes(item.path)));
  return moved;
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
}

export async function trashImmichGroup(groupId: string, keepId: string): Promise<number> {
  const settings = await loadSettings();
  requireImmich(settings.immich.baseUrl, settings.immich.apiKey);
  const results = await requireResults("immich");
  const group = requireGroup(results, groupId);
  const ids = matchedIds(group);
  if (!ids.includes(keepId)) throw new AppError("The kept file is not a matched Immich asset");
  const victims = ids.filter((id) => id !== keepId);
  if (victims.length === 0) throw new AppError("Nothing else in this group can be trashed");
  await trashAssets(settings.immich.baseUrl, settings.immich.apiKey, victims);
  await saveResults("immich", dropItems(results, (item) => item.assetId !== null && victims.includes(item.assetId)));
  return victims.length;
}

export async function rejoinImmich(): Promise<number> {
  const settings = await loadSettings();
  requireImmich(settings.immich.baseUrl, settings.immich.apiKey);
  const results = await requireResults("immich");
  const assets = await listImmichAssets(
    settings.immich.baseUrl,
    settings.immich.apiKey,
    settings.immich.scan.includeImages,
  );
  const groups = attachAssets(results.groups, assets, settings.immich.pathMap);
  await saveResults("immich", { ...results, warning: null, groups });
  return groups.reduce((sum, group) => sum + group.items.filter((item) => item.assetId).length, 0);
}

export async function testImmichConnection(baseUrl: string, apiKey: string): Promise<void> {
  const settings = await loadSettings();
  const url = baseUrl.trim() || settings.immich.baseUrl;
  const key = apiKey.trim() || settings.immich.apiKey;
  requireImmich(url, key);
  await pingImmich(url, key);
}

export async function realResultPath(section: SectionId, candidate: string, group?: StoredGroup): Promise<string> {
  const results = await requireResults(section);
  const source = group ?? results.groups.find((item) => item.items.some((entry) => entry.path === candidate));
  const known = new Set((source ? source.items : results.groups.flatMap((item) => item.items)).map((item) => item.path));
  if (!known.has(candidate)) throw new AppError("That file is not in the current results");
  const roots = section === "server" ? loadConfig().mediaRoots : [loadConfig().immichLibrary];
  const real = await resolveInside(roots, candidate);
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

function dropItems(results: StoredResults, remove: (item: StoredItem) => boolean): StoredResults {
  return {
    ...results,
    groups: results.groups
      .map((group) => ({ ...group, items: group.items.filter((item) => !remove(item)) }))
      .filter((group) => group.items.length >= 2),
  };
}
