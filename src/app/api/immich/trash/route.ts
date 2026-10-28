import { NextResponse } from "next/server";
import { resultsPatch, trashImmichGroup, trashImmichGroups, trashImmichItems } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";
import { loadTrashStats, trashStatsSavedTotal } from "@/lib/store";

export const POST = api(async (request) => {
  const body = (await request.json()) as {
    groupId?: string;
    keepId?: string;
    trashIds?: string[];
    groups?: { groupId?: string; keepId?: string }[];
  };
  if (Array.isArray(body.groups)) {
    const entries = body.groups.flatMap((entry) =>
      typeof entry?.groupId === "string" && typeof entry.keepId === "string"
        ? [{ groupId: entry.groupId, keepId: entry.keepId }]
        : [],
    );
    if (entries.length === 0 || entries.length !== body.groups.length) throw new AppError("Choose groups to trash");
    const outcome = await trashImmichGroups(entries);
    return NextResponse.json({
      trashed: outcome.trashed,
      failed: outcome.failed,
      patch: await resultsPatch("immich", outcome.touched),
      totalSavedBytes: trashStatsSavedTotal(await loadTrashStats()),
    });
  }
  if (!body.groupId) throw new AppError("Choose an asset to keep");
  const trashed = Array.isArray(body.trashIds)
    ? await trashImmichItems(body.groupId, body.trashIds)
    : await trashImmichGroup(body.groupId, requiredKeep(body.keepId));
  return NextResponse.json({
    trashed,
    patch: await resultsPatch("immich", [body.groupId]),
    totalSavedBytes: trashStatsSavedTotal(await loadTrashStats()),
  });
});

function requiredKeep(value: string | undefined): string {
  if (!value) throw new AppError("Choose an asset to keep");
  return value;
}
