import { NextResponse } from "next/server";
import { stackImmichGroup } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";

export const POST = api(async (request) => {
  const body = (await request.json()) as { groupId?: string; primaryId?: string; assetIds?: string[] };
  if (!body.groupId || !body.primaryId) throw new AppError("Choose an asset to keep as the primary");
  if (body.assetIds && !Array.isArray(body.assetIds)) throw new AppError("Choose files to stack");
  await stackImmichGroup(body.groupId, body.primaryId, body.assetIds);
  return NextResponse.json({ ok: true });
});
