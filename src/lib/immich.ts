import { assertHttpUrl, safeFetch } from "./urls";

export type ImmichAsset = { id: string; originalPath: string };

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

export async function listImmichAssets(baseUrl: string, apiKey: string, includeImages: boolean): Promise<ImmichAsset[]> {
  const types = includeImages ? ["VIDEO", "IMAGE"] : ["VIDEO"];
  const assets: ImmichAsset[] = [];
  for (const type of types) {
    let page = 1;
    for (let guard = 0; guard < 500; guard += 1) {
      const response = await safeFetch(`${immichRoot(baseUrl)}/api/search/metadata`, {
        method: "POST",
        headers: headers(apiKey, true),
        body: JSON.stringify({ page, size: 1000, type, withExif: false }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Immich search failed (${response.status})`);
      const body = (await response.json()) as {
        assets?: { items?: unknown[]; nextPage?: string | number | null };
        items?: unknown[];
        nextPage?: string | number | null;
      };
      const items = body.assets?.items ?? body.items ?? [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const record = item as { id?: unknown; originalPath?: unknown };
        if (typeof record.id === "string" && typeof record.originalPath === "string") {
          assets.push({ id: record.id, originalPath: record.originalPath });
        }
      }
      const next = body.assets?.nextPage ?? body.nextPage;
      if (!next || items.length === 0) break;
      const parsed = Number(next);
      page = Number.isFinite(parsed) && parsed > page ? parsed : page + 1;
    }
  }
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

export async function openImmichThumbnail(baseUrl: string, apiKey: string, assetId: string): Promise<Response> {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(assetId)) throw new Error("Unknown asset");
  return safeFetch(`${immichRoot(baseUrl)}/api/assets/${assetId}/thumbnail?size=preview`, {
    headers: { "x-api-key": apiKey, accept: "image/*" },
    signal: AbortSignal.timeout(20_000),
  });
}
