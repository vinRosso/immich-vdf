import { NextResponse } from "next/server";
import { trashImmichGroup, trashImmichItems } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";
import { loadTrashStats, trashStatsSavedTotal } from "@/lib/store";

export const POST = api(async (request) => {
  const body = (await request.json()) as { groupId?: string; keepId?: string; trashIds?: string[] };
  if (!body.groupId) throw new AppError("Choose an asset to keep");
  const trashed = Array.isArray(body.trashIds)
    ? await trashImmichItems(body.groupId, body.trashIds)
    : await trashImmichGroup(body.groupId, requiredKeep(body.keepId));
  return NextResponse.json({ trashed, totalSavedBytes: trashStatsSavedTotal(await loadTrashStats()) });
});

function requiredKeep(value: string | undefined): string {
  if (!value) throw new AppError("Choose an asset to keep");
  return value;
}
