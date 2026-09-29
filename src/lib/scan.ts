import { spawn, type ChildProcess } from "node:child_process";
import { redact } from "./redact";
import type { SectionId } from "./types";

export type ScanListener = (event: ScanEvent) => void;

export type ScanEvent =
  | {
      event: "snapshot";
      running: boolean;
      section: SectionId | null;
      lines: string[];
      error: string | null;
      startedAt: number;
    }
  | { event: "log"; line: string; startedAt: number }
  | { event: "done"; section: SectionId; ok: boolean; error: string | null; groupCount: number | null };

type Begin = {
  section: SectionId;
  trigger: "manual" | "schedule";
  secrets: string[];
  slotKey: string | null;
};

export class ScanManager {
  running = false;
  section: SectionId | null = null;
  trigger: "manual" | "schedule" | null = null;
  slotKey: string | null = null;
  lines: string[] = [];
  error: string | null = null;
  cancelled = false;
  settled = false;
  startedAt = 0;
  claimed = false;
  secrets: string[] = [];
  child: ChildProcess | null = null;
  private listeners = new Set<ScanListener>();

  tryBegin(begin: Begin): boolean {
    if (this.running) return false;
    this.running = true;
    this.section = begin.section;
    this.trigger = begin.trigger;
    this.slotKey = begin.slotKey;
    this.lines = [];
    this.error = null;
    this.cancelled = false;
    this.settled = false;
    this.startedAt = Date.now();
    this.claimed = false;
    this.secrets = begin.secrets;
    this.child = null;
    this.emit({
      event: "snapshot",
      running: true,
      section: begin.section,
      lines: [],
      error: null,
      startedAt: this.startedAt,
    });
    return true;
  }

  claim(): boolean {
    if (this.claimed) return false;
    this.claimed = true;
    return true;
  }

  abortBegin(message: string): void {
    if (this.settled) return;
    this.claimed = true;
    this.settled = true;
    const section = this.section;
    this.running = false;
    this.error = message;
    this.child = null;
    if (section) this.emit({ event: "done", section, ok: false, error: message, groupCount: null });
  }

  attach(child: ChildProcess): void {
    this.child = child;
    const take = (chunk: Buffer) => {
      this.push(chunk.toString("utf8"));
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
  }

  private pending = "";

  push(text: string): void {
    this.pending += text;
    const parts = this.pending.split(/\r\n|\n|\r/);
    this.pending = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (trimmed) this.addLine(trimmed);
    }
  }

  addLine(line: string): void {
    const clean = redact(line, this.secrets).slice(0, 4000);
    this.lines.push(clean);
    if (this.lines.length > 500) this.lines.splice(0, this.lines.length - 500);
    this.emit({ event: "log", line: clean, startedAt: this.startedAt });
  }

  finish(ok: boolean, error: string | null, groupCount: number | null): void {
    if (this.settled) return;
    this.settled = true;
    const section = this.section;
    if (this.pending) {
      this.addLine(this.pending);
      this.pending = "";
    }
    this.running = false;
    this.child = null;
    this.error = error;
    if (section) this.emit({ event: "done", section, ok, error, groupCount });
  }

  cancel(): boolean {
    if (!this.running) return false;
    this.cancelled = true;
    if (this.child) killChildTree(this.child);
    return true;
  }

  subscribe(listener: ScanListener): () => void {
    this.listeners.add(listener);
    listener({
      event: "snapshot",
      running: this.running,
      section: this.section,
      lines: [...this.lines],
      error: this.error,
      startedAt: this.startedAt,
    });
    return () => this.listeners.delete(listener);
  }

  private emit(event: ScanEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export type ScanStatusPayload = {
  running: boolean;
  section: SectionId | null;
  lines: string[];
  error: string | null;
  startedAt: number;
};

export function scanStatusPayload(): ScanStatusPayload {
  const scan = getScan();
  return {
    running: scan.running,
    section: scan.section,
    lines: [...scan.lines],
    error: scan.error,
    startedAt: scan.startedAt,
  };
}

export function getScan(): ScanManager {
  const holder = process as NodeJS.Process & { __vdfScan?: ScanManager };
  if (!holder.__vdfScan) holder.__vdfScan = new ScanManager();
  return holder.__vdfScan;
}

function killChildTree(child: ChildProcess): void {
  const pid = child.pid;
  if (process.platform === "win32" && pid) {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { shell: false, stdio: "ignore" }).on("error", () => {
      child.kill("SIGKILL");
    });
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, 4000).unref?.();
}
