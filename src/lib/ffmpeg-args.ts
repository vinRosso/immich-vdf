export function posterArgs(file: string, seconds: number, output: string): string[] {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  if (seconds > 0) args.push("-ss", seconds.toFixed(3));
  args.push("-i", file, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", output);
  return args;
}

export function filmstripArgs(file: string, seconds: number, output: string): string[] {
  return posterArgs(file, seconds, output);
}

export function transcodeArgs(file: string, seconds: number, mode: "remux" | "transcode"): string[] {
  const args = ["-hide_banner", "-loglevel", "error"];
  if (mode === "transcode") args.push("-fflags", "nobuffer", "-flags", "low_delay");
  args.push("-ss", Math.max(0, seconds).toFixed(3), "-i", file);
  if (mode === "remux") args.push("-c", "copy");
  else {
    args.push(
      "-vf",
      "scale='min(1920,iw)':-2",
      "-c:v",
      "libx264",
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
