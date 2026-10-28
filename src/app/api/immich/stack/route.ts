import { NextResponse } from "next/server";
import { resultsPatch, stackImmichGroup, stackImmichGroups } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";

export const POST = api(async (request) => {
  const body = (await request.json()) as {
    groupId?: string;
    primaryId?: string;
    assetIds?: string[];
    groups?: { groupId?: string; primaryId?: string }[];
  };
  if (Array.isArray(body.groups)) {
    const entries = body.groups.flatMap((entry) =>
      typeof entry?.groupId === "string" && typeof entry.primaryId === "string"
        ? [{ groupId: entry.groupId, primaryId: entry.primaryId }]
        : [],
    );
    if (entries.length === 0 || entries.length !== body.groups.length) throw new AppError("Choose groups to stack");
    const outcome = await stackImmichGroups(entries);
    return NextResponse.json({ ok: true, failed: outcome.failed, patch: await resultsPatch("immich", outcome.touched) });
  }
  if (!body.groupId || !body.primaryId) throw new AppError("Choose an asset to keep as the primary");
  if (body.assetIds && !Array.isArray(body.assetIds)) throw new AppError("Choose files to stack");
  await stackImmichGroup(body.groupId, body.primaryId, body.assetIds);
  return NextResponse.json({ ok: true, patch: await resultsPatch("immich", [body.groupId]) });
});
