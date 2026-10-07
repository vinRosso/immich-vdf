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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** SOF markers carry sample precision. DHT, DAC, SOS, and RST markers do not. */
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export type HeaderBitDepth = number | "more" | "unknown";

/**
 * Bit depth per channel from the start of a JPEG, PNG, or GIF.
 * `more` means the buffer ended inside a marker that may still hold the depth.
 */
export function bitDepthFromHeader(buf: Uint8Array): HeaderBitDepth {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return jpegBitDepth(buf);
  if (buf.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => buf[index] === byte)) {
    if (buf.length < 25) return "more";
    const depth = buf[24] ?? 0;
    return depth > 0 && depth <= 32 ? depth : "unknown";
  }
  if (buf.length >= 6) {
    const sig = String.fromCharCode(buf[0] ?? 0, buf[1] ?? 0, buf[2] ?? 0, buf[3] ?? 0, buf[4] ?? 0, buf[5] ?? 0);
    if (sig === "GIF87a" || sig === "GIF89a") return 8;
  } else if (buf.length > 0 && (buf[0] === 0x47 || buf[0] === 0x89 || buf[0] === 0xff)) {
    return "more";
  }
  return buf.length < 12 ? "more" : "unknown";
}

function jpegBitDepth(buf: Uint8Array): HeaderBitDepth {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return "unknown";
    i += 1;
    while (i < buf.length && buf[i] === 0xff) i += 1;
    if (i >= buf.length) return "more";
    const marker = buf[i] ?? 0;
    i += 1;
    if (marker === 0xd9 || marker === 0xda) return "unknown";
    if (JPEG_SOF.has(marker)) {
      if (i + 3 > buf.length) return "more";
      const precision = buf[i + 2] ?? 0;
      return precision > 0 && precision <= 32 ? precision : "unknown";
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (i + 2 > buf.length) return "more";
    const length = ((buf[i] ?? 0) << 8) | (buf[i + 1] ?? 0);
    if (length < 2) return "unknown";
    if (i + length > buf.length) return "more";
    i += length;
  }
  return "more";
}
