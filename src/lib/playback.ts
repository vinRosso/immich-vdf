export type ProbeSummary = {
  formatNames: string[];
  videoCodec: string | null;
  audioCodec: string | null;
  duration: number;
  width: number;
  height: number;
};

export type PlaybackMode = "direct" | "remux" | "transcode";

function has(names: string[], ...needles: string[]): boolean {
  return names.some((name) => needles.includes(name));
}

export function playbackMode(probe: ProbeSummary): PlaybackMode {
  const names = probe.formatNames.flatMap((name) => name.split(","));
  const mp4 = has(names, "mp4", "mov", "m4a");
  const webm = has(names, "webm");
  const video = probe.videoCodec?.toLowerCase() ?? "";
  const audio = probe.audioCodec?.toLowerCase() ?? "";
  const mp4Video = video === "h264" || video === "av1";
  const webmVideo = video === "vp9" || video === "av1";
  const mp4Audio = audio === "" || audio === "aac" || audio === "mp3";
  const webmAudio = audio === "" || audio === "opus" || audio === "vorbis";
  if ((mp4 && mp4Video && mp4Audio) || (webm && webmVideo && webmAudio)) return "direct";
  const copyableVideo = video === "h264" || video === "av1" || video === "vp9";
  const copyableAudio = audio === "" || audio === "aac" || audio === "mp3" || audio === "opus" || audio === "vorbis";
  if (copyableVideo && copyableAudio) return "remux";
  return "transcode";
}

export function parseFfprobe(json: unknown): ProbeSummary {
  if (!json || typeof json !== "object") throw new Error("ffprobe returned an unexpected payload");
  const record = json as { format?: { format_name?: string; duration?: string }; streams?: unknown[] };
  const streams = (Array.isArray(record.streams) ? record.streams : []).filter(isStream);
  const videos = streams.filter((stream) => stream.codec_type === "video" && !isAttachedPicture(stream));
  const audios = streams.filter((stream) => stream.codec_type === "audio");
  const video = videos[0];
  const audio = audios[0];
  const duration = Number(record.format?.duration ?? video?.duration ?? 0);
  return {
    formatNames: (record.format?.format_name ?? "").split(",").map((name) => name.trim()).filter(Boolean),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    duration: Number.isFinite(duration) ? duration : 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
  };
}

function isStream(value: unknown): value is {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  disposition?: { attached_pic?: number };
} {
  return Boolean(value) && typeof value === "object";
}

function isAttachedPicture(stream: { disposition?: { attached_pic?: number }; codec_name?: string }): boolean {
  return stream.disposition?.attached_pic === 1;
}
