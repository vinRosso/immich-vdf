const PROGRESS_RE = /\[\s*(\d+)%\]\s*(\d+)\/(\d+)/;

export type ScanProgressInfo = {
  percent: number;
  label: string;
  detail: string | null;
  /** CLI is done; server is saving results or matching Immich. */
  indeterminate?: boolean;
};

const POST_COMPARE = [
  { test: /reusing last compare/i, label: "Reusing last compare", detail: "Library unchanged…" },
  { test: /Matching Immich library/i, label: "Matching Immich assets", detail: "Linking files to the library…" },
  { test: /Processing results/i, label: "Processing results", detail: "Reading file metadata…" },
  { test: /Finishing up/i, label: "Finishing up", detail: "Preparing your results…" },
] as const;

const PROGRESS_COUNT_RE = /(\d+)\s*\/\s*(\d+)\s+(paths|images)\b/i;

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

function postComparePhase(lines: string[]): ScanProgressInfo | null {
  for (const phase of POST_COMPARE) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!phase.test.test(lines[i])) continue;
      const count = progressCount(lines[i]);
      const detail = progressCountDetail(lines[i], phase.detail);
      if (!count || count.total <= 0) {
        return { percent: 0, label: phase.label, detail, indeterminate: true };
      }
      const percent = Math.min(100, Math.max(0, Math.round((count.current / count.total) * 100)));
      return { percent, label: phase.label, detail, indeterminate: false };
    }
  }
  return null;
}

/** Parse vdf-cli stderr progress lines into UI state. */
export function parseScanProgress(lines: string[]): ScanProgressInfo {
  const postCompare = postComparePhase(lines);
  if (postCompare) return postCompare;
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
      detail: "Waiting for vdf-cli to exit…",
      indeterminate: true,
    };
  }
  return { percent: clamped, label, detail };
}
