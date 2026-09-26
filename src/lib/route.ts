import { NextResponse, type NextRequest } from "next/server";
import { AppError, errorText } from "./errors";
import { PathJailError } from "./path-jail";
import { redact } from "./redact";
import { cookieIsValid } from "./session";
import { loadSettings, secretValues } from "./store";
import { HttpUrlError } from "./urls";

export function api(handler: (request: NextRequest) => Promise<NextResponse>): (request: NextRequest) => Promise<NextResponse> {
  return async (request) => {
    try {
      if (!(await cookieIsValid(request.headers.get("cookie")))) {
        return NextResponse.json({ error: "Sign in required" }, { status: 401 });
      }
      return await handler(request);
    } catch (error) {
      const settings = await loadSettings().catch(() => null);
      const secrets = settings ? secretValues(settings) : [];
      const known = error instanceof AppError || error instanceof PathJailError || error instanceof HttpUrlError;
      const message = known && error instanceof Error ? error.message : "Something went wrong";
      if (!known) console.error(redact(errorText(error), secrets));
      const status = error instanceof AppError ? error.status : known ? 400 : 500;
      return NextResponse.json({ error: redact(message, secrets) }, { status });
    }
  };
}
