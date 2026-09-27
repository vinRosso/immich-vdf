import { NextResponse } from "next/server";
import { listFolders } from "@/lib/folders";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";
import type { SectionId } from "@/lib/types";

export const GET = api(async (request) => {
  const section = request.nextUrl.searchParams.get("section");
  if (section !== "server" && section !== "immich") throw new AppError("Unknown section");
  const folder = request.nextUrl.searchParams.get("path");
  return NextResponse.json(await listFolders(section as SectionId, folder && folder.trim() ? folder : null));
});
