import { NextResponse } from "next/server";
import { mergeImmichStacks } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";

export const POST = api(async (request) => {
  const body = (await request.json()) as { groupId?: string; primaryId?: string };
  if (!body.groupId || !body.primaryId) throw new AppError("Choose the stack primary");
  await mergeImmichStacks(body.groupId, body.primaryId);
  return NextResponse.json({ ok: true });
});
