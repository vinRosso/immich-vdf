import { NextResponse } from "next/server";
import { albumsForAssets } from "@/lib/actions";
import { listAlbumsForAsset } from "@/lib/immich";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";
import { loadSettings } from "@/lib/store";

/** `?assetIds=a,b,c` returns `{ albumsByAsset }` for the whole group. `?assetId=a` returns `{ albums }`. */
export const GET = api(async (request) => {
  const many = request.nextUrl.searchParams.get("assetIds");
  if (many !== null) {
    const ids = many.split(",").map((id) => id.trim()).filter(Boolean);
    return NextResponse.json({ albumsByAsset: await albumsForAssets(ids) });
  }
  const assetId = request.nextUrl.searchParams.get("assetId") ?? "";
  const settings = await loadSettings();
  if (!settings.immich.baseUrl || !settings.immich.apiKey) {
    throw new AppError("Connect Immich before loading albums", 400);
  }
  const albums = await listAlbumsForAsset(settings.immich.baseUrl, settings.immich.apiKey, assetId);
  return NextResponse.json({ albums });
});
