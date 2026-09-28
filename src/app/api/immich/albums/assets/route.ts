import { NextResponse } from "next/server";
import { mutateImmichAlbumAsset } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";

export const POST = api(async (request) => {
  const body = (await request.json()) as { albumId?: string; assetId?: string; action?: string };
  if (!body.albumId || !body.assetId) throw new AppError("Missing album or asset");
  if (body.action !== "add" && body.action !== "remove") throw new AppError("Unknown album action");
  await mutateImmichAlbumAsset(body.albumId, body.assetId, body.action);
  return NextResponse.json({ ok: true });
});
