import { NextResponse } from "next/server";
import { trashServerGroup } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";
import { emptyTrash, listTrash } from "@/lib/trash";

export const GET = api(async () => NextResponse.json({ entries: await listTrash() }));

export const POST = api(async (request) => {
  const body = (await request.json()) as { groupId?: string; keepPath?: string };
  if (!body.groupId || !body.keepPath) throw new AppError("Choose a file to keep");
  const moved = await trashServerGroup(body.groupId, body.keepPath);
  return NextResponse.json({ moved });
});

export const DELETE = api(async () => NextResponse.json({ removed: await emptyTrash() }));
