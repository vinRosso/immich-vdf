import { NextResponse } from "next/server";
import { savedImmichStatus } from "@/lib/actions";
import { api } from "@/lib/route";

export const GET = api(async () => NextResponse.json(await savedImmichStatus()));
