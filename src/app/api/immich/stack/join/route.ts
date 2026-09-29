import { NextResponse } from "next/server";
import { addToImmichStack } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";

export const POST = api(async (request) => {
  const body = (await request.json()) as { groupId?: string; assetIds?: string[] };
  if (!body.groupId) throw new AppError("Choose a group");
  await addToImmichStack(body.groupId, body.assetIds);
  return NextResponse.json({ ok: true });
});
