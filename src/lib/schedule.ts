import type { ScheduleSettings } from "./types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WINDOW_MS = 10 * 60 * 1000;

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  const weekday = WEEKDAYS.indexOf(parts.weekday as (typeof WEEKDAYS)[number]);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    weekday,
  };
}

export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = desired;
  for (let pass = 0; pass < 3; pass += 1) {
    const zoned = zonedParts(new Date(utc), timeZone);
    const got = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, 0);
    const delta = got - desired;
    if (delta === 0) break;
    utc -= delta;
  }
  return new Date(utc);
}

function addCalendarDays(year: number, month: number, day: number, days: number) {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function clock(schedule: ScheduleSettings): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(schedule.time);
  if (!match) return { hour: 0, minute: 0 };
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function slotKeyFor(schedule: ScheduleSettings, when: Date): string {
  const zoned = zonedParts(when, schedule.timezone);
  return `${zoned.year}-${String(zoned.month).padStart(2, "0")}-${String(zoned.day).padStart(2, "0")}`;
}

export function nextOccurrence(schedule: ScheduleSettings, now: Date): Date | null {
  if (schedule.mode === "off") return null;
  const { hour, minute } = clock(schedule);
  const today = zonedParts(now, schedule.timezone);
  for (let offset = 0; offset < 8; offset += 1) {
    const date = addCalendarDays(today.year, today.month, today.day, offset);
    const probe = zonedTimeToUtc(date.year, date.month, date.day, 12, 0, schedule.timezone);
    const weekday = zonedParts(probe, schedule.timezone).weekday;
    if (schedule.mode === "weekly" && weekday !== schedule.weekday) continue;
    const slot = zonedTimeToUtc(date.year, date.month, date.day, hour, minute, schedule.timezone);
    if (slot.getTime() > now.getTime()) return slot;
  }
  return null;
}

export function dueSlot(schedule: ScheduleSettings, now: Date, lastSlotKey: string | null): string | null {
  if (schedule.mode === "off") return null;
  const zoned = zonedParts(now, schedule.timezone);
  if (schedule.mode === "weekly" && zoned.weekday !== schedule.weekday) return null;
  const { hour, minute } = clock(schedule);
  const scheduled = zonedTimeToUtc(zoned.year, zoned.month, zoned.day, hour, minute, schedule.timezone);
  const delta = now.getTime() - scheduled.getTime();
  if (delta < 0 || delta > WINDOW_MS) return null;
  const key = slotKeyFor(schedule, scheduled);
  if (key === lastSlotKey) return null;
  return key;
}

/** How long after its time a slot that could not start is still worth running. */
const CATCH_UP_MS = 24 * 60 * 60 * 1000;

/** A slot is started at most this many times, so a scan that takes the server down is not repeated after every restart. */
export const MAX_SLOT_ATTEMPTS = 3;

function pendingSlotValid(schedule: ScheduleSettings, now: Date, pending: string, lastSlotKey: string | null): boolean {
  if (schedule.mode === "off" || pending === lastSlotKey) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(pending);
  if (!match) return false;
  const { hour, minute } = clock(schedule);
  const scheduled = zonedTimeToUtc(Number(match[1]), Number(match[2]), Number(match[3]), hour, minute, schedule.timezone);
  const age = now.getTime() - scheduled.getTime();
  return age >= 0 && age <= CATCH_UP_MS;
}

export type ScheduleDecision =
  | { action: "none" }
  /** Start a scheduled scan for this slot. */
  | { action: "start"; slot: string }
  /** The slot is due but a scan is running. Keep it until that scan is done. */
  | { action: "queue"; slot: string }
  /**
   * A pending slot that can no longer run. `missed` is false when it was simply finished or switched off, and
   * `tooManyTries` is true when it was started `MAX_SLOT_ATTEMPTS` times without ever reaching its end.
   */
  | { action: "drop"; slot: string; missed: boolean; tooManyTries?: boolean };

/**
 * What the scheduler should do for one section on this tick. A due slot that finds another scan running
 * waits in line instead of being skipped, and a slot that never ran to the end (the server stopped first)
 * is tried again after the restart, within a day.
 */
export function decideScheduled(
  schedule: ScheduleSettings,
  now: Date,
  run: { slotKey: string | null; pendingSlot?: string | null; pendingAttempts?: number },
  busy: "idle" | "this-section-scheduled" | "other",
): ScheduleDecision {
  const pending = run.pendingSlot ?? null;
  const pendingOk = pending !== null && pendingSlotValid(schedule, now, pending, run.slotKey);
  const exhausted = pending !== null && (run.pendingAttempts ?? 0) >= MAX_SLOT_ATTEMPTS;
  const due = dueSlot(schedule, now, run.slotKey);
  // A slot that is due now replaces an older one that is still waiting, unless it is the one that keeps failing.
  const slot = due !== null && !(exhausted && due === pending) ? due : pendingOk && !exhausted ? pending : null;
  if (slot === null) {
    if (pending === null) return { action: "none" };
    const finished = pending === run.slotKey || schedule.mode === "off";
    if (!finished && exhausted && pendingOk) return { action: "drop", slot: pending, missed: true, tooManyTries: true };
    return { action: "drop", slot: pending, missed: !finished };
  }
  if (busy === "this-section-scheduled") return { action: "none" };
  if (busy === "other") return pending === slot ? { action: "none" } : { action: "queue", slot };
  return { action: "start", slot };
}

/**
 * What a finished run writes about its slot. A run the server cut short stays pending so the next start runs it again;
 * it ended in an orderly way, so it does not count as an attempt that took the server down.
 */
export function slotPatch(
  trigger: "manual" | "schedule" | null,
  slotKey: string | null,
  interrupted: boolean,
): { slotKey?: string | null; pendingSlot?: null; pendingAttempts?: number } {
  if (trigger !== "schedule") return {};
  return interrupted ? { pendingAttempts: 0 } : { slotKey, pendingSlot: null, pendingAttempts: 0 };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
