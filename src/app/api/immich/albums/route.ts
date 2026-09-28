import { NextResponse } from "next/server";
import { listAlbumsForAsset } from "@/lib/immich";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";
import { loadSettings } from "@/lib/store";

export const GET = api(async (request) => {
  const assetId = request.nextUrl.searchParams.get("assetId") ?? "";
  const settings = await loadSettings();
  if (!settings.immich.baseUrl || !settings.immich.apiKey) {
    throw new AppError("Connect Immich before loading albums", 400);
  }
  const albums = await listAlbumsForAsset(settings.immich.baseUrl, settings.immich.apiKey, assetId);
  return NextResponse.json({ albums });
});
