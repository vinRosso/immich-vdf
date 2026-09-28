import { assertHttpUrl, safeFetch } from "./urls";

export type ImmichAsset = { id: string; originalPath: string };
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

function parseSearchPage(body: unknown): SearchPage {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const nested = record.assets && typeof record.assets === "object" ? (record.assets as Record<string, unknown>) : null;
  const rawItems = (nested?.items ?? record.items) as unknown;
  const items: ImmichAsset[] = [];
  if (Array.isArray(rawItems)) {
    for (const item of rawItems) {
      if (!item || typeof item !== "object") continue;
      const asset = item as { id?: unknown; originalPath?: unknown };
      if (typeof asset.id === "string" && typeof asset.originalPath === "string") {
        items.push({ id: asset.id, originalPath: asset.originalPath });
      }
    }
  }
  const next = nested?.nextPage ?? record.nextPage;
  const nextPage = typeof next === "string" || typeof next === "number" ? next : null;
  return { items, nextPage };
}

async function searchMetadataPage(
  baseUrl: string,
  apiKey: string,
  query: { page: number; type: string; originalFileName?: string },
): Promise<SearchPage> {
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/search/metadata`, {
    method: "POST",
    headers: headers(apiKey, true),
    body: JSON.stringify({ page: query.page, size: 1000, type: query.type, withExif: false, originalFileName: query.originalFileName }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Immich search failed (${response.status})`);
  return parseSearchPage(await response.json());
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
    const batch = await searchMetadataPage(baseUrl, apiKey, { page, type, originalFileName });
    assets.push(...batch.items);
    if (!batch.nextPage || batch.items.length === 0) break;
    const parsed = Number(batch.nextPage);
    page = Number.isFinite(parsed) && parsed > page ? parsed : page + 1;
  }
  return assets;
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

export async function stackAssets(baseUrl: string, apiKey: string, assetIds: string[]): Promise<void> {
  const response = await safeFetch(`${immichRoot(baseUrl)}/api/stacks`, {
    method: "POST",
    headers: headers(apiKey, true),
    body: JSON.stringify({ assetIds }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Immich stack failed (${response.status})`);
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
