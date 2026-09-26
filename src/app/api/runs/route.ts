import { NextResponse } from "next/server";
import { api } from "@/lib/route";
import { runsView } from "@/lib/runtime";

export const GET = api(async () => NextResponse.json(await runsView()));
