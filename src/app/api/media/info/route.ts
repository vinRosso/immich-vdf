import { NextResponse } from "next/server";
import { realResultPath } from "@/lib/actions";
import { AppError } from "@/lib/errors";
import { playbackMode } from "@/lib/playback";
import { probeFile } from "@/lib/probe";
import { api } from "@/lib/route";
import { resultMediaMeta } from "@/lib/store";
import type { MediaInfo, SectionId } from "@/lib/types";

export const GET = api(async (request) => {
  const section = request.nextUrl.searchParams.get("section");
  const filePath = request.nextUrl.searchParams.get("path");
  if ((section !== "server" && section !== "immich") || !filePath) throw new AppError("Missing media");
  const real = await realResultPath(section as SectionId, filePath);
  const item = (await resultMediaMeta(section as SectionId, real)) ?? (await resultMediaMeta(section as SectionId, filePath));
  if (item?.isImage) {
    const body: MediaInfo = { mode: "direct", duration: 0, width: item.width, height: item.height, videoCodec: null, audioCodec: null };
    return NextResponse.json(body);
  }
  try {
    const probe = await probeFile(real);
    const body: MediaInfo = {
      mode: playbackMode(probe),
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
    };
    return NextResponse.json(body);
  } catch {
    const body: MediaInfo = {
      mode: "transcode",
      duration: item?.durationSeconds ?? 0,
      width: item?.width ?? 0,
      height: item?.height ?? 0,
      videoCodec: null,
      audioCodec: null,
    };
    return NextResponse.json(body);
  }
});
