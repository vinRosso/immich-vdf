import { NextResponse } from "next/server";
import { resultsPreview, resultsView } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { DEFAULT_RESULTS_GROUP_SORT, isResultsGroupSortId } from "@/lib/results-sort";
import { api } from "@/lib/route";
import type { SectionId } from "@/lib/types";

export const GET = api(async (request) => {
  const section = request.nextUrl.searchParams.get("section");
  if (section !== "server" && section !== "immich") throw new AppError("Unknown section");
  if (request.nextUrl.searchParams.get("preview") === "1") {
    const sortRaw = request.nextUrl.searchParams.get("sort") ?? "";
    const sortId = isResultsGroupSortId(sortRaw) ? sortRaw : DEFAULT_RESULTS_GROUP_SORT;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 10);
    return NextResponse.json(await resultsPreview(section, sortId, Number.isFinite(limit) ? limit : 10));
  }
  return NextResponse.json(await resultsView(section));
});
