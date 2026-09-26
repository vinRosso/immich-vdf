import { NextResponse } from "next/server";
import { resultsView } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";
import type { SectionId } from "@/lib/types";

export const GET = api(async (request) => {
  const section = request.nextUrl.searchParams.get("section");
  if (section !== "server" && section !== "immich") throw new AppError("Unknown section");
  return NextResponse.json(await resultsView(section as SectionId));
});
