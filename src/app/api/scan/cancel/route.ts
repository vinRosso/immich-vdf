import { NextResponse } from "next/server";
import { api } from "@/lib/route";
import { getScan } from "@/lib/scan";

export const POST = api(async () => NextResponse.json({ cancelled: getScan().cancel() }));
