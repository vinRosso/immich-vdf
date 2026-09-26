import { NextResponse } from "next/server";
import { api } from "@/lib/route";
import { runtimeInfo } from "@/lib/runtime";

export const GET = api(async () => NextResponse.json(await runtimeInfo()));
