export function parseByteRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  if (!header.toLowerCase().startsWith("bytes=")) return null;
  const spec = header.slice(header.indexOf("=") + 1).split(",")[0]?.trim() ?? "";
  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match || size <= 0) return null;
  const [, startRaw, endRaw] = match;
  if (startRaw === "" && endRaw === "") return null;
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }
  const start = Number(startRaw);
  const end = endRaw === "" ? size - 1 : Number(endRaw);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}
