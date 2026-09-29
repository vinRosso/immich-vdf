export function posterArgs(file: string, seconds: number, output: string): string[] {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  if (seconds > 0) args.push("-ss", seconds.toFixed(3));
  args.push("-i", file, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", output);
  return args;
}

export function filmstripArgs(file: string, seconds: number, output: string): string[] {
  return posterArgs(file, seconds, output);
}

/** Playback starts at the low rung and steps up to the high rung after the picture is moving. */
export const TRANSCODE_START_HEIGHT = 240;
export const TRANSCODE_FULL_HEIGHT = 720;

export function transcodeScale(maxHeight: number): string {
  // libx264 yuv420p rejects odd sizes. Phone clips are often rotated, so a 240/720 box can land on 135×240.
  const box = maxHeight <= TRANSCODE_START_HEIGHT ? "426:240" : "1280:720";
  return `scale=${box}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
}

export function transcodeArgs(
  file: string,
  seconds: number,
  mode: "remux" | "transcode",
  clipSeconds?: number,
  maxHeight: number = TRANSCODE_FULL_HEIGHT,
): string[] {
  const args = ["-hide_banner", "-loglevel", "error"];
  // The preview rung starts as soon as possible. The full rung keeps a normal buffer so playback can
  // catch the low-quality playhead without seeking into data that has not been encoded yet.
  if (mode === "transcode" && maxHeight <= TRANSCODE_START_HEIGHT) args.push("-fflags", "nobuffer", "-flags", "low_delay");
  args.push("-ss", Math.max(0, seconds).toFixed(3), "-i", file);
  if (clipSeconds !== undefined && Number.isFinite(clipSeconds) && clipSeconds > 0) {
    args.push("-t", clipSeconds.toFixed(3));
  }
  if (mode === "remux") args.push("-c", "copy");
  else {
    args.push(
      "-vf",
      transcodeScale(maxHeight),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-g",
      "60",
      "-force_key_frames",
      "expr:gte(t,n_forced*0.5)",
    );
  }
  // Flush a fragment every 0.5s. frag_keyframe alone waits for the next keyframe, so a long GOP delays the first frame.
  args.push(
    "-muxdelay",
    "0",
    "-muxpreload",
    "0",
    "-flush_packets",
    "1",
    "-f",
    "mp4",
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "-frag_duration",
    "500000",
    "pipe:1",
  );
  return args;
}

export function ffprobeArgs(file: string): string[] {
  return ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "--", file];
}

/** Bit depth only: first video stream, no format or extra streams. */
export function ffprobeBitDepthArgs(file: string): string[] {
  return [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_type,bits_per_raw_sample,pix_fmt",
    "-of",
    "json",
    "--",
    file,
  ];
}

export const STRIP_FRAMES = 6;

export function sampleTimes(duration: number, count: number): number[] {
  if (duration <= 0) return [0];
  const times: number[] = [];
  for (let index = 0; index < count; index += 1) {
    times.push(duration * ((index + 1) / (count + 1)));
  }
  return times;
}

export function posterTime(duration: number): number {
  if (duration <= 0) return 0;
  return duration * 0.1;
}
