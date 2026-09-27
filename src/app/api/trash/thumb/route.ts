import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { api } from "@/lib/route";
import { trashThumbFile } from "@/lib/trash";

export const GET = api(async (request) => {
  const mount = request.nextUrl.searchParams.get("mount");
  const relative = request.nextUrl.searchParams.get("relative");
  if (!mount || !relative) throw new AppError("Missing trash file");
  const thumb = await trashThumbFile(mount, relative);
  const info = await stat(thumb.file);
  const body = Readable.toWeb(createReadStream(thumb.file)) as ReadableStream;
  return new NextResponse(body, {
    headers: {
      "Content-Type": thumb.contentType,
      "Content-Length": String(info.size),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
