import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
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

/** One output stream of the CLI. Each keeps its own partial line and its own multibyte decoder. */
type Channel = { decoder: StringDecoder; pending: string };

const CLI_PROGRESS_LINE = /^\[\s*\d+%\]/;

export class ScanManager {
  running = false;
  section: SectionId | null = null;
  trigger: "manual" | "schedule" | null = null;
  slotKey: string | null = null;
  lines: string[] = [];
  error: string | null = null;
  cancelled = false;
  /** Set when the server is shutting down, so the run is recorded as interrupted rather than cancelled. */
  interrupted = false;
  settled = false;
  /** Set during shutdown. No new scan may start. */
  closed = false;
  startedAt = 0;
  claimed = false;
  secrets: string[] = [];
  child: ChildProcess | null = null;
  private listeners = new Set<ScanListener>();
  private channels = new Map<string, Channel>();
  private cliLines: string[] = [];

  tryBegin(begin: Begin): boolean {
    if (this.running || this.closed) return false;
    this.running = true;
    this.section = begin.section;
    this.trigger = begin.trigger;
    this.slotKey = begin.slotKey;
    this.lines = [];
    this.error = null;
    this.cancelled = false;
    this.interrupted = false;
    this.settled = false;
    this.channels.clear();
    this.cliLines = [];
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
    child.stdout?.on("data", (chunk: Buffer) => this.pushChunk("stdout", chunk, true));
    child.stderr?.on("data", (chunk: Buffer) => this.pushChunk("stderr", chunk, true));
  }

  /** Text without a stream of its own, such as a test feeding lines in. */
  push(text: string): void {
    this.pushChunk("text", text, false);
  }

  private pushChunk(name: string, chunk: Buffer | string, fromCli: boolean): void {
    let channel = this.channels.get(name);
    if (!channel) {
      channel = { decoder: new StringDecoder("utf8"), pending: "" };
      this.channels.set(name, channel);
    }
    channel.pending += typeof chunk === "string" ? chunk : channel.decoder.write(chunk);
    const parts = channel.pending.split(/\r\n|\n|\r/);
    channel.pending = parts.pop() ?? "";
    for (const line of parts) this.takeLine(line, fromCli);
  }

  private takeLine(line: string, fromCli: boolean): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (fromCli && !CLI_PROGRESS_LINE.test(trimmed)) {
      this.cliLines.push(trimmed);
      if (this.cliLines.length > 5) this.cliLines.shift();
    }
    this.addLine(trimmed);
  }

  /** Last thing the CLI printed that was not a progress bar, for error messages. */
  cliTail(): string | null {
    const last = this.cliLines[this.cliLines.length - 1];
    return last ? redact(last, this.secrets).slice(0, 300) : null;
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
    for (const channel of this.channels.values()) {
      const rest = (channel.pending + channel.decoder.end()).trim();
      if (rest) this.addLine(rest);
      channel.pending = "";
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

  /** Server shutdown: refuse new scans, stop the current one and let it record itself as interrupted. */
  shutDown(): Promise<boolean> {
    this.closed = true;
    return this.interrupt() ? this.waitForIdle(10_000) : Promise.resolve(true);
  }

  /** Stop the run and let it record itself as interrupted. */
  interrupt(): boolean {
    if (!this.running) return false;
    this.interrupted = true;
    return this.cancel();
  }

  /** Resolves once no scan is running, or after `timeoutMs`. */
  waitForIdle(timeoutMs: number): Promise<boolean> {
    if (!this.running) return Promise.resolve(true);
    return new Promise((resolve) => {
      let unsubscribe = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, timeoutMs);
      unsubscribe = this.subscribe((event) => {
        if (event.event !== "done") return;
        clearTimeout(timer);
        queueMicrotask(() => unsubscribe());
        resolve(true);
      });
    });
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

/** Children start in their own process group on POSIX, so one signal reaches ffmpeg and anything else vdf-cli started. */
export function killChildTree(child: ChildProcess): void {
  const pid = child.pid;
  if (process.platform === "win32" && pid) {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { shell: false, stdio: "ignore" }).on("error", () => {
      child.kill("SIGKILL");
    });
    return;
  }
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      if (pid) process.kill(-pid, signal);
      else child.kill(signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // Already gone.
      }
    }
  };
  signalGroup("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) signalGroup("SIGKILL");
  }, 4000).unref?.();
}
