import { NextResponse } from "next/server";
import { api } from "@/lib/route";
import { publicSettings } from "@/lib/runtime";
import { applySettingsUpdate } from "@/lib/settings-update";
import { updateSettings } from "@/lib/store";
import type { SettingsUpdate } from "@/lib/types";

export const GET = api(async () => NextResponse.json(await publicSettings()));

export const PUT = api(async (request) => {
  const body = (await request.json()) as SettingsUpdate;
  await updateSettings((current) => applySettingsUpdate(current, body));
  return NextResponse.json(await publicSettings());
});
