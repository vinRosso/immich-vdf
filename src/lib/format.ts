export function baseName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

/** Path on the media mount before the file was moved to .vdf-trash. */
export function mountMediaPath(mount: string, relative: string): string {
  const root = mount.replace(/[\\/]+$/, "");
  const tail = relative.replace(/^[/\\]+/, "");
  const sep = root.includes("\\") ? "\\" : "/";
  return `${root}${sep}${tail}`;
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "—";
  if (size < 1024) return `${Math.round(size)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

/** Wall-clock length of a scan, such as `45s`, `12m 4s`, or `1h 23m`. */
export function formatScanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  if (total === 0) return ms > 0 ? "under 1m" : "0s";
  return `${seconds}s`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

export function formatMediaDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleDateString("en-GB", { month: "short" });
  return `${day} ${month} ${date.getFullYear()}`;
}

export function formatClock(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function localCalendarKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Next scheduled run: Today/Tomorrow when applicable, else month and day. */
export function formatNextRun(iso: string | null, now = new Date()): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Never";
  const time = date.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const key = localCalendarKey(date);
  if (key === localCalendarKey(now)) return `Today, ${time}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (key === localCalendarKey(tomorrow)) return `Tomorrow, ${time}`;
  const datePart = date.toLocaleString(undefined, { month: "short", day: "numeric" });
  return `${datePart}, ${time}`;
}

/** Rounded thousands for large library counts, e.g. 43k or "< 1k". */
export function formatCompactThousands(count: number): string {
  if (!Number.isFinite(count) || count < 1000) return "< 1k";
  return `${Math.round(count / 1000)}k`;
}

/** Under Scan: latest successful run, 24-hour clock. */
export function formatLatestOkRun(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const stamp = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `Latest: ${stamp}`;
}
