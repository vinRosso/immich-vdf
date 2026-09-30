import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";
import { loadSettings } from "@/lib/store";
import type { SectionId } from "@/lib/types";
import { assertHttpUrl } from "@/lib/urls";
import { postWebhook } from "@/lib/webhook";

export const POST = api(async (request) => {
  const body = (await request.json().catch(() => ({}))) as {
    section?: SectionId;
    webhookUrl?: string;
  };
  if (body.section !== "server" && body.section !== "immich") {
    throw new AppError("Section is required");
  }
  let url = (body.webhookUrl ?? "").trim();
  if (!url) {
    const settings = await loadSettings();
    url = settings.webhookUrl.trim();
  }
  if (!url) throw new AppError("Enter a webhook URL or save one first");
  assertHttpUrl(url);
  await postWebhook(url, { section: body.section, status: "ok", groupCount: 0 });
  return NextResponse.json({ ok: true });
});
