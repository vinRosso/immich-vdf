import { NextResponse } from "next/server";
import { getRejoinProgress } from "@/lib/immich-rejoin-progress";
import { api } from "@/lib/route";

export const GET = api(async () => NextResponse.json(getRejoinProgress()));
