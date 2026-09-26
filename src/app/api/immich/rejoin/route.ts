import { NextResponse } from "next/server";
import { rejoinImmich } from "@/lib/actions";
import { api } from "@/lib/route";

export const POST = api(async () => NextResponse.json({ matched: await rejoinImmich() }));
