import { NextResponse } from "next/server";
import { ignoreGroup, restoreIgnored } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";
import { loadIgnored } from "@/lib/store";
import type { SectionId } from "@/lib/types";

function sectionOf(value: unknown): SectionId {
  if (value === "server" || value === "immich") return value;
  throw new AppError("Unknown section");
}

export const GET = api(async () =>
  NextResponse.json({
    server: await loadIgnored("server"),
    immich: await loadIgnored("immich"),
  }),
);

export const POST = api(async (request) => {
  const body = (await request.json()) as { section?: string; groupId?: string };
  if (!body.groupId) throw new AppError("Missing group");
  await ignoreGroup(sectionOf(body.section), body.groupId);
  return NextResponse.json({ ok: true });
});

export const DELETE = api(async (request) => {
  const body = (await request.json()) as { section?: string; key?: string };
  if (!body.key) throw new AppError("Missing ignore key");
  await restoreIgnored(sectionOf(body.section), body.key);
  return NextResponse.json({ ok: true });
});
