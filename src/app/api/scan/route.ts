import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { startScan } from "@/lib/jobs";
import { api } from "@/lib/route";

export const POST = api(async (request) => {
  const body = (await request.json()) as { section?: string };
  if (body.section !== "server" && body.section !== "immich") throw new AppError("Unknown section");
  const result = await startScan(body.section, "manual");
  if (!result.ok) throw new AppError(result.error, result.status);
  return NextResponse.json({ started: true });
});
