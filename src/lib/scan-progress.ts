const PROGRESS_RE = /\[\s*(\d+)%\]\s*(\d+)\/(\d+)/;

export type ScanProgressInfo = {
  percent: number;
  label: string;
  detail: string | null;
  /** CLI is done; server is saving results or matching Immich. */
  indeterminate?: boolean;
};

/** Steps the server logs itself. The most recent matching line decides which one is showing. */
const SERVER_PHASES = [
  {
    test: /Checking whether the library changed/i,
    label: "Checking the library",
    detail: "Looking for new or changed files…",
  },
  {
    test: /Reading capture dates/i,
    label: "Reading capture dates",
    detail: "Dates from Immich, then from the files…",
  },
  { test: /reusing last compare/i, label: "Reusing last compare", detail: "Library unchanged…" },
  { test: /Matching Immich library/i, label: "Matching Immich assets", detail: "Linking files to the library…" },
  { test: /Reading Immich stacks/i, label: "Reading Immich stacks", detail: "Checking existing stacks…" },
  { test: /Processing results/i, label: "Processing results", detail: "Reading file metadata…" },
  {
    test: /Grouping images by file name and time|Prefix groups reused|groups from saved times|Joining saved groups/i,
    label: "Grouping by name and time",
    detail: "Applying burst and capture-time groups…",
  },
  { test: /Finishing up/i, label: "Finishing up", detail: "Preparing your results…" },
] as const;

/** Lines the CLI prints while it works. Once one appears after a server step, the CLI is the current phase. */
const CLI_MARKER_RE = /File enumeration complete|Hashing complete|Comparison complete/;

const REUSE_RE = /reusing last compare/i;

const PROGRESS_COUNT_RE = /(\d+)\s*\/\s*(\d+)\s+(paths|images|assets)\b/i;

function progressCount(line: string): { current: number; total: number; noun: string } | null {
  const count = line.match(PROGRESS_COUNT_RE);
  if (!count) return null;
  return { current: Number(count[1]), total: Number(count[2]), noun: count[3].toLowerCase() };
}

function progressCountDetail(line: string, fallback: string): string {
  const count = progressCount(line);
  if (!count) return fallback;
  return `${count.current.toLocaleString()} of ${count.total.toLocaleString()} ${count.noun}`;
}

function serverPhase(lines: string[]): ScanProgressInfo | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    let phase = SERVER_PHASES.find((candidate) => candidate.test.test(line));
    // A reused compare only has the short finishing step left, so keep naming the reuse.
    if (phase?.label === "Finishing up" && lines.slice(0, i).some((earlier) => REUSE_RE.test(earlier))) {
      phase = SERVER_PHASES.find((candidate) => candidate.label === "Reusing last compare");
    }
    if (phase) {
      const count = progressCount(line);
      const detail = progressCountDetail(line, phase.detail);
      if (!count || count.total <= 0) {
        return { percent: 0, label: phase.label, detail, indeterminate: true };
      }
      const percent = Math.min(100, Math.max(0, Math.round((count.current / count.total) * 100)));
      return { percent, label: phase.label, detail, indeterminate: false };
    }
    if (PROGRESS_RE.test(line) || CLI_MARKER_RE.test(line)) return null;
  }
  return null;
}

/** The stage the CLI prints in parentheses at the end of a progress line, with its own counter when it has one. */
const STAGE_RE = /\s{2}\(([A-Za-z][^()]*?)(?:\s+(\d+)\/(\d+))?\)\s*$/;

/**
 * Engine stages that are not plain file hashing. Without these, a stage that counts 1 of 1 (computing AI
 * embeddings) looked like a stuck "Hashing files" bar. Texts are the English ones in VDF.Core/Assets/Locales/en.json.
 */
const STAGES = [
  { test: /^computing AI embeddings$/i, label: "Computing AI embeddings", detail: "Finishing the AI frames…" },
  { test: /^validating duplicate groups$/i, label: "Checking duplicate groups", detail: null },
  { test: /^comparing partial clips$/i, label: "Comparing partial clips", detail: null },
  { test: /^verifying partial clips$/i, label: "Verifying partial clips", detail: null },
  { test: /^AI partial: /i, label: "Finding partial clips with AI", detail: null },
] as const;

type StageInfo = { text: string; current: number; total: number };

function stageOf(line: string): StageInfo | null {
  const match = line.match(STAGE_RE);
  if (!match) return null;
  return { text: match[1].trim(), current: Number(match[2] ?? 0), total: Number(match[3] ?? 0) };
}

/** Parse vdf-cli stderr progress lines into UI state. */
export function parseScanProgress(lines: string[]): ScanProgressInfo {
  const fromServer = serverPhase(lines);
  if (fromServer) return fromServer;
  let percent = 0;
  let current = 0;
  let max = 0;
  let comparing = false;
  let enumerationDone = false;
  let hashingDoneAt = -1;
  let lastProgressAt = -1;
  let stage: StageInfo | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("File enumeration complete")) enumerationDone = true;
    if (line.includes("Hashing complete")) hashingDoneAt = i;
    if (line.includes("Comparison complete")) {
      percent = 100;
      comparing = true;
    }
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/comparing/i.test(line)) comparing = true;
    const match = line.match(PROGRESS_RE);
    if (match) {
      percent = Number(match[1]);
      current = Number(match[2]);
      max = Number(match[3]);
      lastProgressAt = i;
      stage = stageOf(line);
      if (/comparing/i.test(line)) comparing = true;
      break;
    }
  }

  const comparingDuplicates = stage !== null && /comparing duplicates/i.test(stage.text);
  // Hashing is over and the compare has not printed any progress yet: loading files and building the list.
  if (hashingDoneAt >= 0 && hashingDoneAt >= lastProgressAt && !comparingDuplicates && !lines.some((line) => line.includes("Comparison complete"))) {
    return {
      percent: 0,
      label: "Preparing comparison",
      detail: "Checking files and building the compare list…",
      indeterminate: true,
    };
  }

  const known = stage ? STAGES.find((candidate) => candidate.test.test(stage!.text)) : undefined;
  if (known && stage) {
    const counted = max > 1;
    const stageDetail = stage.text.replace(/^AI partial:\s*/i, "");
    const detail = counted
      ? `${current.toLocaleString()} of ${max.toLocaleString()}`
      : known.label === "Finding partial clips with AI"
        ? stageDetail
        : known.detail;
    return { percent: counted ? Math.min(100, Math.max(0, percent)) : 0, label: known.label, detail, indeterminate: !counted };
  }

  let label = "Starting scan…";
  if (!enumerationDone && max === 0) label = "Listing files…";
  else if (comparing) label = "Comparing duplicates";
  else if (max > 0) label = "Hashing files";

  const detail = max > 0 ? `${current} of ${max}` : null;
  const clamped = Math.min(100, Math.max(0, percent));
  if (comparing && clamped >= 100) {
    return {
      percent: 100,
      label: "Finishing comparison",
      detail: "Writing compare output (large libraries can take a minute)…",
      indeterminate: true,
    };
  }
  return { percent: clamped, label, detail };
}
