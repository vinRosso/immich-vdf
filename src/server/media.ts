import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { realResultPath } from "../lib/actions";
import { AppError } from "../lib/errors";
import { TRANSCODE_FULL_HEIGHT, TRANSCODE_START_HEIGHT, transcodeArgs } from "../lib/ffmpeg-args";
import { enqueueFfmpeg } from "../lib/ffmpeg-pool";
import { playbackMode } from "../lib/playback";
import { claimPlayback } from "../lib/playback-sessions";
import { ffmpegBin, probeFile } from "../lib/probe";
import { parseByteRange } from "../lib/range";
import { loadResults, loadSettings } from "../lib/store";
import { thumbRequestSignal } from "../lib/thumb-sessions";
import { ensurePoster, ensureStrip, sectionParallelism } from "../lib/thumbs";
import type { SectionId } from "../lib/types";

export async function streamMedia(
  request: IncomingMessage,
  response: ServerResponse,
  section: SectionId,
  filePath: string,
  startSeconds: number | null,
  requestedMode: string | null,
  playId: string | null,
  maxHeight: number | null = null,
): Promise<void> {
  const real = await realResultPath(section, filePath);
  const session = claimPlayback(playId);
  const onDisconnect = () => {
    if (!response.writableFinished) session.abort();
  };
  response.on("close", onDisconnect);
  try {
    await streamClaimedMedia(request, response, section, real, filePath, startSeconds, requestedMode, session.signal, maxHeight);
  } finally {
    response.off("close", onDisconnect);
    session.release();
  }
}

async function streamClaimedMedia(
  request: IncomingMessage,
  response: ServerResponse,
  section: SectionId,
  real: string,
  filePath: string,
  startSeconds: number | null,
  requestedMode: string | null,
  signal: AbortSignal,
  maxHeight: number | null,
): Promise<void> {
  const results = await loadResults(section);
  const item = results?.groups.flatMap((group) => group.items).find((entry) => entry.path === real || entry.path === filePath);
  const info = await stat(real);
  if (signal.aborted || response.destroyed || response.writableEnded) return;
  if (item?.isImage || isImageExt(real)) {
    sendFile(request, response, real, info.size, contentType(real));
    return;
  }
  const offset = startSeconds && Number.isFinite(startSeconds) ? Math.max(0, Math.min(startSeconds, 24 * 60 * 60)) : 0;
  let mode: "direct" | "remux" | "transcode" =
    requestedMode === "direct" || requestedMode === "remux" || requestedMode === "transcode" ? requestedMode : "transcode";
  let clipSeconds: number | undefined;
  try {
    const probe = await probeFile(real);
    if (requestedMode !== "direct" && requestedMode !== "remux" && requestedMode !== "transcode") {
      mode = playbackMode(probe);
    }
    clipSeconds = Math.max(0.1, probe.duration - offset);
  } catch {
    if (requestedMode !== "direct" && requestedMode !== "remux" && requestedMode !== "transcode") {
      mode = "transcode";
    }
    if (item && item.durationSeconds > 0) {
      clipSeconds = Math.max(0.1, item.durationSeconds - offset);
    }
  }
  if (signal.aborted || response.destroyed || response.writableEnded) return;
  if (mode === "direct") {
    sendFile(request, response, real, info.size, contentType(real));
    return;
  }
  const settings = await loadSettings();
  if (signal.aborted || response.destroyed || response.writableEnded) return;
  response.writeHead(200, {
    "Content-Type": "video/mp4",
    "Cache-Control": "private, no-store",
    "X-Playback-Mode": mode,
    "X-Content-Type-Options": "nosniff",
  });
  const height = mode === "transcode" ? playbackHeight(maxHeight) : TRANSCODE_FULL_HEIGHT;
  await enqueueFfmpeg(settings.server.ffmpegConcurrency, () => pipeFfmpeg(response, transcodeArgs(real, offset, mode, clipSeconds, height), signal), {
    priority: "playback",
    signal,
  });
}

function playbackHeight(requested: number | null): number {
  if (requested === TRANSCODE_START_HEIGHT) return TRANSCODE_START_HEIGHT;
  return TRANSCODE_FULL_HEIGHT;
}

function pipeFfmpeg(response: ServerResponse, args: string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || response.destroyed || response.writableEnded) {
      resolve();
      return;
    }
    const child: ChildProcess = spawn(ffmpegBin(), args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    child.stderr?.resume();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", stop);
      resolve();
    };
    const stop = () => {
      child.stdout?.unpipe(response);
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
      setTimeout(finish, 1000);
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
    child.stdout?.on("error", () => stop());
    child.stdout?.pipe(response);
    child.on("close", finish);
    child.on("error", finish);
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

export async function thumbnailFile(
  section: SectionId,
  filePath: string,
  kind: string,
  index: number,
  options?: { priority?: "viewer" | "thumbnail"; signal?: AbortSignal },
): Promise<string> {
  const real = await realResultPath(section, filePath);
  const parallelism = await sectionParallelism(section);
  const session = thumbRequestSignal(real, options?.signal);
  try {
    const render = { ...options, signal: session.signal };
    if (kind === "poster") return await ensurePoster(real, parallelism, render);
    if (kind === "strip") return await ensureStrip(real, index, parallelism, render);
    throw new AppError("Unknown thumbnail");
  } finally {
    session.release();
  }
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
