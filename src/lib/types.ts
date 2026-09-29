export type SectionId = "server" | "immich";

export type ScanSettings = {
  includes: string[];
  excludes: string[];
  threshold: number;
  percent: number;
  parallelism: number;
  includeImages: boolean;
  usePhash: boolean;
  partialClip: boolean;
  aiMatching: boolean;
  aiPartial: boolean;
  compareHorizontallyFlipped: boolean;
  ignoreBlackPixels: boolean;
  ignoreWhitePixels: boolean;
  /** 0 compares the whole library. Otherwise the capture-time window length in days. */
  timeWindowDays: number;
};

export type ScheduleSettings = {
  mode: "off" | "daily" | "weekly";
  time: string;
  weekday: number;
  timezone: string;
};

export type PathMapEntry = {
  from: string;
  to: string;
};

export type Settings = {
  server: {
    scan: ScanSettings;
    schedule: ScheduleSettings;
  };
  immich: {
    baseUrl: string;
    apiKey: string;
    pathMap: PathMapEntry[];
    scan: ScanSettings;
    schedule: ScheduleSettings;
  };
  webhookUrl: string;
};

export type PublicSettings = {
  server: Settings["server"];
  immich: {
    baseUrl: string;
    apiKeyConfigured: boolean;
    pathMap: PathMapEntry[];
    scan: ScanSettings;
    schedule: ScheduleSettings;
  };
  webhookConfigured: boolean;
};

export type SettingsUpdate = {
  server?: {
    scan?: Partial<ScanSettings>;
    schedule?: Partial<ScheduleSettings>;
  };
  immich?: {
    baseUrl?: string;
    apiKey?: string;
    clearApiKey?: boolean;
    pathMap?: PathMapEntry[];
    scan?: Partial<ScanSettings>;
    schedule?: Partial<ScheduleSettings>;
  };
  webhookUrl?: string;
  clearWebhook?: boolean;
};

export type StoredItem = {
  path: string;
  similarity: number;
  sizeBytes: number;
  durationSeconds: number;
  resolution: string | null;
  width: number;
  height: number;
  bitrateKbps: number;
  bitDepth: number;
  audioBitrateKbps: number;
  dateCreatedMs: number;
  flags: string[];
  partialClipOffsetSeconds: number;
  isImage: boolean;
  format: string | null;
  fps: number;
  assetId: string | null;
  originalPath: string | null;
  /** Immich stack this asset already belongs to. Missing on scans from before stacks were recorded. */
  stackId?: string | null;
  stackPrimary?: boolean;
};

export type StoredGroup = {
  groupId: string;
  items: StoredItem[];
};

export type StoredResults = {
  finishedAt: string;
  /** Wall-clock milliseconds from scan start to finish. Missing on scans from before this was recorded. */
  durationMs?: number | null;
  error: string | null;
  warning: string | null;
  groups: StoredGroup[];
  /** Combined inventory + matching-settings fingerprint from the last full compare. */
  compareFingerprint?: string | null;
  compareInventoryFingerprint?: string | null;
  compareSettingsFingerprint?: string | null;
  /** Window used for the last compare. 0 is the whole library. */
  compareTimeWindowDays?: number | null;
};

export type IgnoredEntry = {
  key: string;
  ignoredAt: string;
  groupId: string;
  labels: string[];
};

export type IgnoredGroupCard = {
  entry: IgnoredEntry;
  group: ClientGroup | null;
};

export type RunRecord = {
  slotKey: string | null;
  at: string | null;
  status: "ok" | "error" | "skipped" | null;
  groupCount: number | null;
  error: string | null;
  trigger: "manual" | "schedule" | null;
};

export type RunsFile = {
  server: RunRecord;
  immich: RunRecord;
};

export type ClientItem = {
  path: string;
  name: string;
  similarity: number;
  sizeBytes: number;
  durationSeconds: number;
  resolution: string | null;
  width: number;
  height: number;
  bitrateKbps: number;
  bitDepth: number;
  audioBitrateKbps: number;
  dateCreatedMs: number;
  flags: string[];
  partialClipOffsetSeconds: number;
  isImage: boolean;
  format: string | null;
  fps: number;
  assetId: string | null;
  originalPath: string | null;
  stackId: string | null;
  stackPrimary: boolean;
  matched: boolean;
  isPrimary: boolean;
};

export type ClientGroup = {
  groupId: string;
  items: ClientItem[];
};

export type UnmatchedFile = {
  name: string;
  path: string;
  originalPath: string | null;
  reason: "no-map" | "no-asset";
  groupId: string;
  isImage: boolean;
};

export type ResultsResponse = {
  section: SectionId;
  scanned: boolean;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  warning: string | null;
  hiddenIgnored: number;
  unmatched: number;
  groups: ClientGroup[];
};

export type RuntimeInfo = {
  cpuCount: number;
  maxParallelism: number;
  suggestedParallelism: number;
  mediaRoots: string[];
  immichLibrary: string;
  immichScanRoots: string[];
  cliAvailable: boolean;
  cliPath: string;
  cliVersion: string | null;
  serverTimeZone: string;
};

export type RunsResponse = {
  server: { last: RunRecord; nextRun: string | null };
  immich: { last: RunRecord; nextRun: string | null };
};

export type TrashEntry = {
  mount: string;
  relative: string;
  sizeBytes: number;
  addedAtMs: number;
};

export type MediaInfo = {
  mode: "direct" | "remux" | "transcode";
  duration: number;
  width: number;
  height: number;
  videoCodec: string | null;
  audioCodec: string | null;
};
