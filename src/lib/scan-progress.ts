const PROGRESS_RE = /\[\s*(\d+)%\]\s*(\d+)\/(\d+)/;

export type ScanProgressInfo = {
  percent: number;
  label: string;
  detail: string | null;
};

/** Parse vdf-cli stderr progress lines into UI state. */
export function parseScanProgress(lines: string[]): ScanProgressInfo {
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
  return { percent: Math.min(100, Math.max(0, percent)), label, detail };
}
