import { NextResponse } from "next/server";
import { undoServerTrash } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";

export const POST = api(async (request) => {
  const body = (await request.json()) as { id?: string };
  if (!body.id) throw new AppError("Missing undo id");
  return NextResponse.json({ restored: await undoServerTrash(body.id) });
});
