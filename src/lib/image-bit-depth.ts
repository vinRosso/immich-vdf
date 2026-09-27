type FfprobeStream = {
  codec_type?: string;
  bits_per_raw_sample?: number | string;
  pix_fmt?: string;
  disposition?: { attached_pic?: number };
};

/** Bit depth per channel from ffprobe JSON (first non-attached video stream). */
export function imageBitDepthFromFfprobe(json: unknown): number {
  if (!json || typeof json !== "object") return 0;
  const streams = (json as { streams?: unknown[] }).streams;
  if (!Array.isArray(streams)) return 0;
  for (const raw of streams) {
    if (!raw || typeof raw !== "object") continue;
    const stream = raw as FfprobeStream;
    if (stream.codec_type !== "video" || stream.disposition?.attached_pic === 1) continue;
    const fromSample = parsePositiveInt(stream.bits_per_raw_sample);
    if (fromSample > 0) return fromSample;
    const fromPix = bitDepthFromPixFmt(stream.pix_fmt);
    if (fromPix > 0) return fromPix;
  }
  return 0;
}

function parsePositiveInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 0;
}

function bitDepthFromPixFmt(pixFmt: string | undefined): number {
  if (!pixFmt) return 0;
  const fmt = pixFmt.toLowerCase();
  if (fmt.includes("64") || fmt.includes("48le") || fmt.includes("48be")) return 16;
  if (fmt.includes("16")) return 16;
  if (fmt.includes("10")) return 10;
  if (fmt.includes("12")) return 12;
  if (fmt.includes("9")) return 9;
  return 8;
}
