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

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
