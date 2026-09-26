import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { realResultPath } from "../lib/actions";
import { AppError } from "../lib/errors";
import { transcodeArgs } from "../lib/ffmpeg-args";
import { enqueueFfmpeg } from "../lib/ffmpeg-pool";
import { playbackMode } from "../lib/playback";
import { ffmpegBin, probeFile } from "../lib/probe";
import { parseByteRange } from "../lib/range";
import { loadResults, loadSettings } from "../lib/store";
import { ensurePoster, ensureStrip } from "../lib/thumbs";
import type { SectionId } from "../lib/types";

export async function streamMedia(
  request: IncomingMessage,
  response: ServerResponse,
  section: SectionId,
  filePath: string,
  startSeconds: number | null,
): Promise<void> {
  const real = await realResultPath(section, filePath);
  const results = await loadResults(section);
  const item = results?.groups.flatMap((group) => group.items).find((entry) => entry.path === real || entry.path === filePath);
  const info = await stat(real);
  if (item?.isImage || isImageExt(real)) {
    sendFile(request, response, real, info.size, contentType(real));
    return;
  }
  let mode: "direct" | "remux" | "transcode" = "transcode";
  try {
    mode = playbackMode(await probeFile(real));
  } catch {
    mode = "transcode";
  }
  if (mode === "direct") {
    sendFile(request, response, real, info.size, contentType(real));
    return;
  }
  const settings = await loadSettings();
  const offset = startSeconds && Number.isFinite(startSeconds) ? Math.max(0, Math.min(startSeconds, 24 * 60 * 60)) : 0;
  response.writeHead(200, {
    "Content-Type": "video/mp4",
    "Cache-Control": "private, no-store",
    "X-Playback-Mode": mode,
    "X-Content-Type-Options": "nosniff",
  });
  await enqueueFfmpeg(settings.server.ffmpegConcurrency, () =>
    pipeFfmpeg(request, response, transcodeArgs(real, offset, mode)),
  );
}

function pipeFfmpeg(request: IncomingMessage, response: ServerResponse, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(ffmpegBin(), args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    child.stderr?.resume();
    child.stdout?.pipe(response);
    const stop = () => {
      child.kill("SIGKILL");
    };
    request.on("close", stop);
    response.on("close", stop);
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}

function sendFile(request: IncomingMessage, response: ServerResponse, file: string, size: number, type: string): void {
  const header = request.headers.range;
  const common = {
    "Accept-Ranges": "bytes",
    "Content-Type": type,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!header) {
    response.writeHead(200, { ...common, "Content-Length": size });
    pipeRange(request, response, file, 0, size - 1);
    return;
  }
  const range = parseByteRange(header, size);
  if (!range) {
    response.writeHead(416, { "Content-Range": `bytes */${size}` });
    response.end();
    return;
  }
  response.writeHead(206, {
    ...common,
    "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
    "Content-Length": range.end - range.start + 1,
  });
  pipeRange(request, response, file, range.start, range.end);
}

function pipeRange(request: IncomingMessage, response: ServerResponse, file: string, start: number, end: number): void {
  const stream = createReadStream(file, { start, end });
  stream.pipe(response);
  const stop = () => stream.destroy();
  request.on("close", stop);
  response.on("close", stop);
}

export async function thumbnailFile(section: SectionId, filePath: string, kind: string, index: number): Promise<string> {
  if (section !== "server") throw new AppError("Immich thumbnails come from Immich", 404);
  const real = await realResultPath("server", filePath);
  if (kind === "poster") return ensurePoster(real);
  if (kind === "strip") return ensureStrip(real, index);
  throw new AppError("Unknown thumbnail");
}

export function sectionParam(value: string | null): SectionId {
  if (value === "server" || value === "immich") return value;
  throw new AppError("Unknown section");
}

function contentType(file: string): string {
  const types: Record<string, string> = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return types[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function isImageExt(file: string): boolean {
  return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff"].includes(path.extname(file).toLowerCase());
}
