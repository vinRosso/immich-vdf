import { NextResponse } from "next/server";
import { extractResultGroup } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";
import type { SectionId } from "@/lib/types";

function sectionOf(value: unknown): SectionId {
  if (value === "server" || value === "immich") return value;
  throw new AppError("Unknown section");
}

export const POST = api(async (request) => {
  const body = (await request.json()) as { section?: string; groupId?: string; paths?: string[] };
  if (!body.groupId) throw new AppError("Missing group");
  if (!Array.isArray(body.paths) || body.paths.some((path) => typeof path !== "string")) {
    throw new AppError("Choose files to extract");
  }
  const groupId = await extractResultGroup(sectionOf(body.section), body.groupId, body.paths);
  return NextResponse.json({ groupId });
});
