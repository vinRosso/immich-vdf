import { assertHttpUrl, safeFetch } from "./urls";

export type ImmichAsset = {
  id: string;
  originalPath: string;
  stackId?: string | null;
  stackPrimary?: boolean;
  isArchived?: boolean;
};

export type ImmichStack = {
  id: string;
  primaryAssetId: string;
  assets: { id: string; originalPath: string; updatedAt?: string }[];
};
export type ImmichAlbum = { id: string; name: string };

export function immichRoot(baseUrl: string): string {
  const url = assertHttpUrl(baseUrl.trim());
  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/api")) pathname = pathname.slice(0, -4);
  return `${url.origin}${pathname}`;
}

function headers(apiKey: string, json = false): HeadersInit {
  const value: Record<string, string> = { "x-api-key": apiKey, accept: "application/json" };
  if (json) value["content-type"] = "application/json";
  return value;
}

export type ImmichUser = { id: string; email: string; name: string; storageLabel: string | null };

export async function pingImmich(baseUrl: string, apiKey: string): Promise<void> {
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/server/ping`, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Immich rejected the API key");
  }
  if (!response.ok) throw new Error(`Immich ping failed (${response.status})`);
}

export type ImmichAssetStatistics = { images: number; videos: number; total: number };

export async function fetchImmichAssetStatistics(baseUrl: string, apiKey: string): Promise<ImmichAssetStatistics> {
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/assets/statistics`, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Immich rejected the API key for asset statistics");
  }
  if (!response.ok) throw new Error(`Immich asset statistics failed (${response.status})`);
  const body = (await response.json()) as { images?: unknown; videos?: unknown; total?: unknown };
  const images = typeof body.images === "number" && Number.isFinite(body.images) ? body.images : 0;
  const videos = typeof body.videos === "number" && Number.isFinite(body.videos) ? body.videos : 0;
  const total = typeof body.total === "number" && Number.isFinite(body.total) ? body.total : images + videos;
  return { images, videos, total };
}

export async function fetchImmichUser(baseUrl: string, apiKey: string): Promise<ImmichUser> {
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/users/me`, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Immich rejected the API key");
  }
  if (!response.ok) throw new Error(`Immich user lookup failed (${response.status})`);
  const body = (await response.json()) as {
    id?: unknown;
    email?: unknown;
    name?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    storageLabel?: unknown;
  };
  const email = typeof body.email === "string" ? body.email : "";
  const direct = typeof body.name === "string" ? body.name.trim() : "";
  const parts = [body.firstName, body.lastName].filter((part) => typeof part === "string" && part.trim()) as string[];
  const name = direct || parts.join(" ").trim() || email || "Immich user";
  const id = typeof body.id === "string" ? body.id : "";
  const storageLabel = typeof body.storageLabel === "string" && body.storageLabel.trim() ? body.storageLabel.trim() : null;
  return { id, email, name, storageLabel };
}

export function importPathsFromLibraries(body: unknown): string[] {
  const libraries = Array.isArray(body) ? body : [];
  const paths: string[] = [];
  for (const library of libraries) {
    if (!library || typeof library !== "object") continue;
    const importPaths = (library as { importPaths?: unknown }).importPaths;
    if (!Array.isArray(importPaths)) continue;
    for (const entry of importPaths) {
      if (typeof entry === "string" && entry.trim()) paths.push(entry.trim());
    }
  }
  return [...new Set(paths)];
}

/** External library import paths as configured in Immich (container paths). */
export async function listImmichLibraryImportPaths(baseUrl: string, apiKey: string): Promise<string[]> {
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/libraries`, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Immich rejected the API key for libraries");
  }
  if (!response.ok) throw new Error(`Immich libraries failed (${response.status})`);
  return importPathsFromLibraries(await response.json());
}

type SearchPage = { items: ImmichAsset[]; nextPage: string | number | null };

const TRASHED_AFTER_EPOCH = "1970-01-01T00:00:00.000Z";

/** True when Immich marks an asset as archived in the library. */
export function immichAssetArchived(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as { isArchived?: unknown }).isArchived === true;
}

/** True when Immich marks an asset as in the trash (not visible in the main library). */
export function immichAssetTrashed(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as { isTrashed?: unknown; deletedAt?: unknown };
  if (record.isTrashed === true) return true;
  return typeof record.deletedAt === "string" && record.deletedAt.length > 0;
}

function parseSearchPage(body: unknown): SearchPage {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const nested = record.assets && typeof record.assets === "object" ? (record.assets as Record<string, unknown>) : null;
  const rawItems = (nested?.items ?? record.items) as unknown;
  const items: ImmichAsset[] = [];
  if (Array.isArray(rawItems)) {
    for (const item of rawItems) {
      if (!item || typeof item !== "object") continue;
      if (immichAssetTrashed(item)) continue;
      const asset = item as { id?: unknown; originalPath?: unknown; stack?: unknown };
      if (typeof asset.id === "string" && typeof asset.originalPath === "string") {
        const stack = stackFields(asset.stack, asset.id);
        items.push({
          id: asset.id,
          originalPath: asset.originalPath,
          ...stack,
          isArchived: immichAssetArchived(item),
        });
      }
    }
  }
  const next = nested?.nextPage ?? record.nextPage;
  const nextPage = typeof next === "string" || typeof next === "number" ? next : null;
  return { items, nextPage };
}

type MetadataSearchQuery = {
  page: number;
  type: string;
  originalFileName?: string;
  updatedAfter?: string;
  withDeleted?: boolean;
  trashedAfter?: string;
  withArchived?: boolean;
  isArchived?: boolean;
};

function searchMetadataBody(query: MetadataSearchQuery): string {
  const body: Record<string, unknown> = {
    page: query.page,
    size: 1000,
    type: query.type,
    withExif: false,
    withDeleted: query.withDeleted ?? false,
    originalFileName: query.originalFileName,
    updatedAfter: query.updatedAfter,
    trashedAfter: query.trashedAfter,
  };
  if (query.withArchived !== undefined) body.withArchived = query.withArchived;
  if (query.isArchived !== undefined) body.isArchived = query.isArchived;
  return JSON.stringify(body);
}

async function searchMetadataPage(baseUrl: string, apiKey: string, query: MetadataSearchQuery): Promise<SearchPage> {
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/search/metadata`, {
    method: "POST",
    headers: headers(apiKey, true),
    body: searchMetadataBody(query),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Immich search failed (${response.status})`);
  return parseSearchPage(await response.json());
}

export type TrashedImmichLookup = { ids: Set<string>; originalPaths: Set<string> };

function parseTrashedFromSearchBody(body: unknown): { entries: { id: string; originalPath: string | null }[]; nextPage: string | number | null } {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const nested = record.assets && typeof record.assets === "object" ? (record.assets as Record<string, unknown>) : null;
  const rawItems = (nested?.items ?? record.items) as unknown;
  const entries: { id: string; originalPath: string | null }[] = [];
  if (Array.isArray(rawItems)) {
    for (const item of rawItems) {
      if (!item || typeof item !== "object") continue;
      const asset = item as { id?: unknown; originalPath?: unknown };
      if (typeof asset.id !== "string" || !immichAssetTrashed(item)) continue;
      entries.push({
        id: asset.id,
        originalPath: typeof asset.originalPath === "string" ? asset.originalPath : null,
      });
    }
  }
  const next = nested?.nextPage ?? record.nextPage;
  const nextPage = typeof next === "string" || typeof next === "number" ? next : null;
  return { entries, nextPage };
}

/** Trashed Immich assets (ids and original paths) for filtering scan results and cache. */
export async function listTrashedImmichAssets(baseUrl: string, apiKey: string): Promise<TrashedImmichLookup> {
  const ids = new Set<string>();
  const originalPaths = new Set<string>();
  for (const type of ["IMAGE", "VIDEO"]) {
    let page = 1;
    for (let guard = 0; guard < 500; guard += 1) {
      const response = await safeFetch(`${immichRoot(baseUrl)}/api/search/metadata`, {
        method: "POST",
        headers: headers(apiKey, true),
        body: searchMetadataBody({ page, type, withDeleted: true, trashedAfter: TRASHED_AFTER_EPOCH }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Immich trash search failed (${response.status})`);
      const batch = parseTrashedFromSearchBody(await response.json());
      for (const entry of batch.entries) {
        ids.add(entry.id);
        if (entry.originalPath) originalPaths.add(entry.originalPath.replace(/\\/g, "/"));
      }
      if (!batch.nextPage || batch.entries.length === 0) break;
      const parsed = Number(batch.nextPage);
      page = Number.isFinite(parsed) && parsed > page ? parsed : page + 1;
    }
  }
  return { ids, originalPaths };
}

/** Asset ids currently in Immich trash (for filtering scan results and cache). */
export async function listTrashedImmichAssetIds(baseUrl: string, apiKey: string): Promise<Set<string>> {
  return (await listTrashedImmichAssets(baseUrl, apiKey)).ids;
}

/** Asset ids Immich marks as archived (hidden from the main timeline). */
export async function listArchivedImmichAssetIds(baseUrl: string, apiKey: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const type of ["IMAGE", "VIDEO"]) {
    let page = 1;
    for (let guard = 0; guard < 500; guard += 1) {
      const batch = await searchMetadataPage(baseUrl, apiKey, { page, type, isArchived: true, withArchived: true });
      for (const asset of batch.items) {
        if (asset.isArchived) ids.add(asset.id);
      }
      if (!batch.nextPage || batch.items.length === 0) break;
      const parsed = Number(batch.nextPage);
      page = Number.isFinite(parsed) && parsed > page ? parsed : page + 1;
    }
  }
  return ids;
}

async function searchAllPages(
  baseUrl: string,
  apiKey: string,
  type: string,
  originalFileName?: string,
  maxPages = 500,
): Promise<ImmichAsset[]> {
  const assets: ImmichAsset[] = [];
  let page = 1;
  for (let guard = 0; guard < maxPages; guard += 1) {
    const batch = await searchMetadataPage(baseUrl, apiKey, { page, type, originalFileName, withArchived: true });
    assets.push(...batch.items);
    if (!batch.nextPage || batch.items.length === 0) break;
    const parsed = Number(batch.nextPage);
    page = Number.isFinite(parsed) && parsed > page ? parsed : page + 1;
  }
  return assets;
}

export type ImmichAssetUpdate = { id: string; updatedAt: string };

/** Assets Immich has modified after `updatedAfter`. Search results omit stack membership. */
export async function listImmichAssetsUpdatedSince(
  baseUrl: string,
  apiKey: string,
  updatedAfter: string,
): Promise<ImmichAssetUpdate[]> {
  const pages = await Promise.all(["IMAGE", "VIDEO"].map((type) => listUpdatedOfType(baseUrl, apiKey, type, updatedAfter)));
  const byId = new Map<string, string>();
  for (const batch of pages) {
    for (const asset of batch) byId.set(asset.id, asset.updatedAt);
  }
  return [...byId.entries()].map(([id, updatedAt]) => ({ id, updatedAt }));
}

async function listUpdatedOfType(
  baseUrl: string,
  apiKey: string,
  type: string,
  updatedAfter: string,
): Promise<ImmichAssetUpdate[]> {
  const items: ImmichAssetUpdate[] = [];
  let page = 1;
  for (let guard = 0; guard < 20; guard += 1) {
    const response = await safeFetch(`${immichRoot(baseUrl)}/api/search/metadata`, {
      method: "POST",
      headers: headers(apiKey, true),
      body: searchMetadataBody({ page, type, updatedAfter }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Immich update search failed (${response.status})`);
    const batch = parseUpdatedAssets(await response.json());
    items.push(...batch.items);
    if (!batch.nextPage || batch.items.length === 0) break;
    const parsed = Number(batch.nextPage);
    page = Number.isFinite(parsed) && parsed > page ? parsed : page + 1;
  }
  return items;
}

function parseUpdatedAssets(body: unknown): { items: ImmichAssetUpdate[]; nextPage: string | number | null } {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const nested = record.assets && typeof record.assets === "object" ? (record.assets as Record<string, unknown>) : null;
  const rawItems = (nested?.items ?? record.items) as unknown;
  const items: ImmichAssetUpdate[] = [];
  if (Array.isArray(rawItems)) {
    for (const item of rawItems) {
      if (!item || typeof item !== "object") continue;
      const asset = item as { id?: unknown; updatedAt?: unknown };
      if (typeof asset.id === "string" && typeof asset.updatedAt === "string") {
        items.push({ id: asset.id, updatedAt: asset.updatedAt });
      }
    }
  }
  const next = nested?.nextPage ?? record.nextPage;
  const nextPage = typeof next === "string" || typeof next === "number" ? next : null;
  return { items, nextPage };
}

export async function fetchImmichAssetStackId(baseUrl: string, apiKey: string, assetId: string): Promise<string | null> {
  assertImmichId(assetId, "asset");
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/assets/${assetId}`, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Immich asset lookup failed (${response.status})`);
  const body = (await response.json()) as { stack?: unknown };
  if (immichAssetTrashed(body)) return null;
  return stackFields(body.stack, assetId).stackId;
}

export async function listImmichAssets(baseUrl: string, apiKey: string, includeImages: boolean): Promise<ImmichAsset[]> {
  const types = includeImages ? ["VIDEO", "IMAGE"] : ["VIDEO"];
  const assets: ImmichAsset[] = [];
  for (const type of types) assets.push(...(await searchAllPages(baseUrl, apiKey, type)));
  return assets;
}

/** Assets whose file name matches. Used to resolve duplicate paths without paging the whole library. */
export async function searchImmichAssetsByFileName(
  baseUrl: string,
  apiKey: string,
  fileName: string,
  includeImages: boolean,
): Promise<ImmichAsset[]> {
  const types = includeImages ? ["VIDEO", "IMAGE"] : ["VIDEO"];
  const assets: ImmichAsset[] = [];
  for (const type of types) assets.push(...(await searchAllPages(baseUrl, apiKey, type, fileName, 20)));
  return assets;
}

function stackFields(stack: unknown, assetId: string): { stackId: string | null; stackPrimary: boolean } {
  if (!stack || typeof stack !== "object") return { stackId: null, stackPrimary: false };
  const record = stack as { id?: unknown; primaryAssetId?: unknown };
  const stackId = typeof record.id === "string" ? record.id : null;
  const primaryAssetId = typeof record.primaryAssetId === "string" ? record.primaryAssetId : null;
  return { stackId, stackPrimary: Boolean(stackId && primaryAssetId === assetId) };
}

export function parseImmichStack(body: unknown): ImmichStack | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { id?: unknown; primaryAssetId?: unknown; assets?: unknown };
  if (typeof record.id !== "string" || typeof record.primaryAssetId !== "string" || !Array.isArray(record.assets)) return null;
  const assets: ImmichStack["assets"] = [];
  for (const entry of record.assets) {
    if (!entry || typeof entry !== "object") continue;
    const asset = entry as { id?: unknown; originalPath?: unknown; updatedAt?: unknown };
    if (immichAssetTrashed(entry)) continue;
    if (typeof asset.id === "string" && typeof asset.originalPath === "string") {
      assets.push({
        id: asset.id,
        originalPath: asset.originalPath,
        updatedAt: typeof asset.updatedAt === "string" ? asset.updatedAt : undefined,
      });
    }
  }
  if (assets.length === 0) return null;
  return { id: record.id, primaryAssetId: record.primaryAssetId, assets };
}

export async function fetchImmichStack(baseUrl: string, apiKey: string, stackId: string): Promise<ImmichStack | null> {
  assertImmichId(stackId, "stack");
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/stacks/${stackId}`, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Immich stack lookup failed (${response.status})`);
  return parseImmichStack(await response.json());
}

export async function stackAssets(baseUrl: string, apiKey: string, assetIds: string[]): Promise<ImmichStack> {
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/stacks`, {
    method: "POST",
    headers: headers(apiKey, true),
    body: JSON.stringify({ assetIds }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Immich stack failed (${response.status})`);
  const parsed = parseImmichStack(await response.json());
  if (parsed) return parsed;
  return { id: "", primaryAssetId: assetIds[0] ?? "", assets: assetIds.map((id) => ({ id, originalPath: "" })) };
}

/** Pull assets out of a stack. Immich deletes the stack when fewer than two assets remain. */
export async function removeAssetsFromStack(baseUrl: string, apiKey: string, stackId: string, assetIds: string[]): Promise<void> {
  assertImmichId(stackId, "stack");
  for (const assetId of assetIds) assertImmichId(assetId, "asset");
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/stacks/${stackId}/assets`, {
    method: "DELETE",
    headers: headers(apiKey, true),
    body: JSON.stringify({ assetIds }),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`Immich stack remove failed (${response.status})`);
}

export async function updateStackPrimary(
  baseUrl: string,
  apiKey: string,
  stackId: string,
  primaryAssetId: string,
): Promise<ImmichStack | null> {
  assertImmichId(stackId, "stack");
  assertImmichId(primaryAssetId, "asset");
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/stacks/${stackId}`, {
    method: "PUT",
    headers: headers(apiKey, true),
    body: JSON.stringify({ primaryAssetId }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Immich stack primary failed (${response.status})`);
  const text = await response.text();
  if (!text) return null;
  try {
    return parseImmichStack(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export async function trashAssets(baseUrl: string, apiKey: string, ids: string[]): Promise<void> {
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/assets`, {
    method: "DELETE",
    headers: headers(apiKey, true),
    body: JSON.stringify({ ids }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Immich trash failed (${response.status})`);
}

export function parseAlbumList(body: unknown): ImmichAlbum[] {
  if (!Array.isArray(body)) return [];
  const albums: ImmichAlbum[] = [];
  for (const entry of body) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { id?: unknown; albumName?: unknown; name?: unknown };
    if (typeof record.id !== "string") continue;
    const name =
      typeof record.albumName === "string" && record.albumName.trim()
        ? record.albumName.trim()
        : typeof record.name === "string" && record.name.trim()
          ? record.name.trim()
          : "";
    if (name) albums.push({ id: record.id, name });
  }
  return albums;
}

/** Albums that contain this asset (user-visible via API key). */
function assertImmichId(id: string, label: string): void {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) throw new Error(`Unknown ${label}`);
}

export async function addAssetsToAlbum(baseUrl: string, apiKey: string, albumId: string, assetIds: string[]): Promise<void> {
  assertImmichId(albumId, "album");
  for (const assetId of assetIds) assertImmichId(assetId, "asset");
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/albums/${albumId}/assets`, {
    method: "PUT",
    headers: headers(apiKey, true),
    body: JSON.stringify({ ids: assetIds }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Immich add to album failed (${response.status})`);
}

export async function removeAssetsFromAlbum(baseUrl: string, apiKey: string, albumId: string, assetIds: string[]): Promise<void> {
  assertImmichId(albumId, "album");
  for (const assetId of assetIds) assertImmichId(assetId, "asset");
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/albums/${albumId}/assets`, {
    method: "DELETE",
    headers: headers(apiKey, true),
    body: JSON.stringify({ ids: assetIds }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Immich remove from album failed (${response.status})`);
}

export async function listAlbumsForAsset(baseUrl: string, apiKey: string, assetId: string): Promise<ImmichAlbum[]> {
  assertImmichId(assetId, "asset");
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/albums?assetId=${encodeURIComponent(assetId)}`, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Immich rejected the API key for albums");
  }
  if (!response.ok) throw new Error(`Immich albums failed (${response.status})`);
  return parseAlbumList(await response.json());
}

export async function openImmichThumbnail(baseUrl: string, apiKey: string, assetId: string): Promise<Response> {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(assetId)) throw new Error("Unknown asset");
  return safeFetch(`${immichRoot(baseUrl)}/api/assets/${assetId}/thumbnail?size=preview`, {
    headers: { "x-api-key": apiKey, accept: "image/*" },
    signal: AbortSignal.timeout(20_000),
  });
}

/** Original file, for compare when the path is not on a mounted folder. */
export async function openImmichOriginal(baseUrl: string, apiKey: string, assetId: string): Promise<Response> {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(assetId)) throw new Error("Unknown asset");
  return safeFetch(`${immichRoot(baseUrl)}/api/assets/${assetId}/original`, {
    headers: { "x-api-key": apiKey, accept: "image/*" },
    signal: AbortSignal.timeout(60_000),
  });
}
