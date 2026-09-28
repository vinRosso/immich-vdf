import { NextResponse } from "next/server";
import { unmatchedImmichReport } from "@/lib/actions";
import { api } from "@/lib/route";

export const GET = api(async () => NextResponse.json(await unmatchedImmichReport()));
