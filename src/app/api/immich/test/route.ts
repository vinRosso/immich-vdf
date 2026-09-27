import { NextResponse } from "next/server";
import { testImmichConnection } from "@/lib/actions";
import { api } from "@/lib/route";

export const POST = api(async (request) => {
  const body = (await request.json().catch(() => ({}))) as { baseUrl?: string; apiKey?: string };
  const info = await testImmichConnection(body.baseUrl ?? "", body.apiKey ?? "");
  return NextResponse.json({ ok: true, ...info });
});
