export type ParsedItem = {
  path: string;
  similarity: number;
  sizeBytes: number;
  durationSeconds: number;
  resolution: string | null;
  bitrateKbps: number;
  audioBitrateKbps: number;
  dateCreatedMs: number;
  flags: string[];
  partialClipOffsetSeconds: number;
  isImage: boolean;
  format: string | null;
  fps: number;
};

export type ParsedGroup = {
  groupId: string;
  items: ParsedItem[];
};

export function parseCliResults(raw: string): ParsedGroup[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("VDF JSON output is not valid JSON");
  }
  if (!Array.isArray(data)) throw new Error("VDF JSON output must be an array of groups");
  return data.map((group, index) => parseGroup(group, index));
}

function parseGroup(value: unknown, index: number): ParsedGroup {
  const group = asRecord(value, `group ${index + 1}`);
  const groupId = requiredString(group, "GroupId", `group ${index + 1}`);
  const items = group.Items;
  if (!Array.isArray(items)) throw new Error(`group ${index + 1} is missing Items`);
  return {
    groupId,
    items: items.map((item, itemIndex) => parseItem(item, index, itemIndex)),
  };
}

function parseItem(value: unknown, groupIndex: number, itemIndex: number): ParsedItem {
  const where = `group ${groupIndex + 1} item ${itemIndex + 1}`;
  const item = asRecord(value, where);
  return {
    path: requiredString(item, "Path", where),
    similarity: requiredNumber(item, "Similarity", where),
    sizeBytes: requiredNumber(item, "SizeLong", where),
    durationSeconds: parseTimeSpan(item.Duration, where, "Duration"),
    resolution: optionalString(item.FrameSize),
    bitrateKbps: requiredNumber(item, "BitRateKbs", where),
    audioBitrateKbps: optionalNumber(item.AudioBitRateKbs),
    dateCreatedMs: parseOptionalDate(item.DateCreated),
    flags: parseFlags(item.Flags, where),
    partialClipOffsetSeconds:
      item.PartialClipOffset === undefined ? 0 : parseTimeSpan(item.PartialClipOffset, where, "PartialClipOffset"),
    isImage: item.IsImage === true,
    format: optionalString(item.Format),
    fps: typeof item.Fps === "number" ? item.Fps : 0,
  };
}

function parseFlags(value: unknown, where: string): string[] {
  if (typeof value !== "string") {
    throw new Error(`${where} Flags must be a string enum such as "None" or "PartialClip, AiMatched"`);
  }
  if (value === "" || value === "None") return [];
  return value.split(",").map((flag) => flag.trim()).filter(Boolean);
}

export function parseTimeSpan(value: unknown, where: string, field: string): number {
  if (typeof value !== "string") throw new Error(`${where} ${field} must be a TimeSpan string`);
  const match = /^(?:(\d+)\.)?(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value);
  if (!match) throw new Error(`${where} ${field} is not a TimeSpan`);
  const days = Number(match[1] || 0);
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where} is not an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${where} is missing ${key}`);
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string, where: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${where} is missing ${key}`);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseOptionalDate(value: unknown): number {
  if (typeof value !== "string" || value.length === 0) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}
