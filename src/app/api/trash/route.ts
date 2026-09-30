import { NextResponse } from "next/server";
import { trashServerGroup, trashServerItems } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";
import { loadTrashStats, trashStatsSavedTotal } from "@/lib/store";
import { emptyTrash, listTrash, restoreAllTrash, restoreTrashItem } from "@/lib/trash";

export const GET = api(async (request) => {
  const stats = await loadTrashStats();
  const savedBytes = trashStatsSavedTotal(stats);
  const bytesFreed = stats.bytesFreed;
  const immichBytesTrashed = stats.immichBytesTrashed ?? 0;
  if (request.nextUrl.searchParams.get("summary") === "1") {
    return NextResponse.json({ savedBytes, bytesFreed, immichBytesTrashed });
  }
  const entries = await listTrash();
  const totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  return NextResponse.json({ entries, totalBytes, savedBytes, bytesFreed, immichBytesTrashed });
});

export const POST = api(async (request) => {
  const body = (await request.json()) as { groupId?: string; keepPath?: string; trashPaths?: string[] };
  if (!body.groupId) throw new AppError("Choose a file to keep");
  const moved = Array.isArray(body.trashPaths)
    ? await trashServerItems(body.groupId, body.trashPaths)
    : await trashServerGroup(body.groupId, requiredKeep(body.keepPath));
  return NextResponse.json({ moved });
});

export const PATCH = api(async (request) => {
  const body = (await request.json()) as { mount?: string; relative?: string; all?: boolean };
  if (body.all) return NextResponse.json({ restored: await restoreAllTrash() });
  if (!body.mount?.trim() || !body.relative?.trim()) throw new AppError("Choose a file to restore");
  await restoreTrashItem(body.mount, body.relative);
  return NextResponse.json({ ok: true });
});

export const DELETE = api(async () => NextResponse.json(await emptyTrash()));

function requiredKeep(value: string | undefined): string {
  if (!value) throw new AppError("Choose a file to keep");
  return value;
}
