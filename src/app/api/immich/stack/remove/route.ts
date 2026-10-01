import { NextResponse } from "next/server";
import { removeFromImmichStack } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";

export const POST = api(async (request) => {
  const body = (await request.json()) as { groupId?: string; assetIds?: string[] };
  if (!body.groupId) throw new AppError("Choose a group");
  if (!body.assetIds?.length) throw new AppError("Choose a file to remove from the stack");
  await removeFromImmichStack(body.groupId, body.assetIds);
  return NextResponse.json({ ok: true });
});
