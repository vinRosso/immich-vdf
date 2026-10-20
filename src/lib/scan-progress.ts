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

/** Parse vdf-cli stderr progress lines into UI state. */
export function parseScanProgress(lines: string[]): ScanProgressInfo {
  const fromServer = serverPhase(lines);
  if (fromServer) return fromServer;
  let percent = 0;
  let current = 0;
  let max = 0;
  let comparing = false;
  let enumerationDone = false;

  for (const line of lines) {
    if (line.includes("File enumeration complete")) enumerationDone = true;
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
      if (/comparing/i.test(line)) comparing = true;
      break;
    }
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
