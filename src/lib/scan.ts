import type { ChildProcess } from "node:child_process";
import { redact } from "./redact";
import type { SectionId } from "./types";

export type ScanListener = (event: ScanEvent) => void;

export type ScanEvent =
  | { event: "snapshot"; running: boolean; section: SectionId | null; lines: string[]; error: string | null }
  | { event: "log"; line: string }
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
    this.claimed = false;
    this.secrets = begin.secrets;
    this.child = null;
    this.emit({ event: "snapshot", running: true, section: begin.section, lines: [], error: null });
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
    const parts = this.pending.split(/\r?\n/);
    this.pending = parts.pop() ?? "";
    for (const line of parts) this.addLine(line);
  }

  addLine(line: string): void {
    const clean = redact(line, this.secrets).slice(0, 4000);
    this.lines.push(clean);
    if (this.lines.length > 500) this.lines.splice(0, this.lines.length - 500);
    this.emit({ event: "log", line: clean });
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
    if (!this.running || !this.child) return false;
    this.cancelled = true;
    this.child.kill("SIGTERM");
    const child = this.child;
    setTimeout(() => child.kill("SIGKILL"), 4000).unref?.();
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
    });
    return () => this.listeners.delete(listener);
  }

  private emit(event: ScanEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export function getScan(): ScanManager {
  const holder = globalThis as typeof globalThis & { __vdfScan?: ScanManager };
  if (!holder.__vdfScan) holder.__vdfScan = new ScanManager();
  return holder.__vdfScan;
}
