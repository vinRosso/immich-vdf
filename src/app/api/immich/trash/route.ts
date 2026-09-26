import { NextResponse } from "next/server";
import { trashImmichGroup } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";

export const POST = api(async (request) => {
  const body = (await request.json()) as { groupId?: string; keepId?: string };
  if (!body.groupId || !body.keepId) throw new AppError("Choose an asset to keep");
  const trashed = await trashImmichGroup(body.groupId, body.keepId);
  return NextResponse.json({ trashed });
});
