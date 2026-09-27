import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { parseByteRange } from "@/lib/range";
import { api } from "@/lib/route";
import { trashOriginalFile } from "@/lib/trash";

export const GET = api(async (request) => {
  const mount = request.nextUrl.searchParams.get("mount");
  const relative = request.nextUrl.searchParams.get("relative");
  if (!mount || !relative) throw new AppError("Missing trash file");
  const { file, contentType } = await trashOriginalFile(mount, relative);
  const info = await stat(file);
  const common = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const range = request.headers.get("range");
  if (range) {
    const parsed = parseByteRange(range, info.size);
    if (!parsed) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    }
    const body = Readable.toWeb(createReadStream(file, { start: parsed.start, end: parsed.end })) as ReadableStream;
    return new NextResponse(body, {
      status: 206,
      headers: {
        ...common,
        "Content-Range": `bytes ${parsed.start}-${parsed.end}/${info.size}`,
        "Content-Length": String(parsed.end - parsed.start + 1),
      },
    });
  }
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new NextResponse(body, {
    headers: {
      ...common,
      "Content-Length": String(info.size),
    },
  });
});
