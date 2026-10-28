import { NextResponse } from "next/server";
import { mergeResultGroups, resultsPatch } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";
import type { SectionId } from "@/lib/types";

function sectionOf(value: unknown): SectionId {
  if (value === "server" || value === "immich") return value;
  throw new AppError("Unknown section");
}

export const POST = api(async (request) => {
  const body = (await request.json()) as { section?: string; sourceGroupId?: string; targetGroupId?: string };
  if (!body.sourceGroupId || !body.targetGroupId) throw new AppError("Missing group");
  const section = sectionOf(body.section);
  await mergeResultGroups(section, body.sourceGroupId, body.targetGroupId);
  return NextResponse.json({ ok: true, patch: await resultsPatch(section, [body.sourceGroupId, body.targetGroupId]) });
});
