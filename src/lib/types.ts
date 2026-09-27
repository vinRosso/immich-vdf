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
    ffmpegConcurrency: number;
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
    ffmpegConcurrency?: number;
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
};

export type StoredGroup = {
  groupId: string;
  items: StoredItem[];
};

export type StoredResults = {
  finishedAt: string;
  error: string | null;
  warning: string | null;
  groups: StoredGroup[];
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
  matched: boolean;
  isPrimary: boolean;
};

export type ClientGroup = {
  groupId: string;
  items: ClientItem[];
};

export type ResultsResponse = {
  section: SectionId;
  scanned: boolean;
  finishedAt: string | null;
  error: string | null;
  warning: string | null;
  hiddenIgnored: number;
  unmatched: number;
  groups: ClientGroup[];
};

export type RuntimeInfo = {
  cpuCount: number;
  suggestedFfmpegConcurrency: number;
  suggestedParallelism: number;
  mediaRoots: string[];
  immichLibrary: string;
  immichScanRoots: string[];
  cliAvailable: boolean;
  cliPath: string;
  cliVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
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
