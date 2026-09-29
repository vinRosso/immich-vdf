import { NextResponse } from "next/server";
import { makeImmichStackPrimary } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";

export const POST = api(async (request) => {
  const body = (await request.json()) as { groupId?: string; assetId?: string };
  if (!body.groupId || !body.assetId) throw new AppError("Choose the stack primary");
  await makeImmichStackPrimary(body.groupId, body.assetId);
  return NextResponse.json({ ok: true });
});
