import { NextResponse } from "next/server";
import { updateCli } from "@/lib/cli-update";
import { api } from "@/lib/route";

export const POST = api(async () => NextResponse.json(await updateCli()));
