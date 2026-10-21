"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { api } from "@/components/api";
import { scanOptionsStep } from "@/components/scan-fields";
import { PillButton, SettingsSteps, type StepDef } from "@/components/settings-steps";
import { TimezonePicker } from "@/components/timezone-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { matchingDefaults } from "@/lib/scan-defaults";
import { sectionLabel } from "@/lib/section-label";
import type { PublicSettings, RuntimeInfo, ScanSettings, ScheduleSettings, SectionId } from "@/lib/types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type ScheduleDraft = { schedule: ScheduleSettings; scan: ScanSettings; webhookUrl: string };
export type ScheduleSave = { schedule: ScheduleSettings; webhookUrl: string; clearWebhook: boolean };
type ScheduleSlice = { schedule: ScheduleSettings; scan: ScanSettings; webhookUrl: string; webhookEdited: boolean };

const fieldClass = "h-[34px] rounded-lg border-border bg-secondary text-sm";

export function ScheduleSheet({
  open,
  onOpenChange,
  section,
  draft,
  settings,
  runtime,
  busy,
  hasActiveSchedule,
  nextRunText,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SectionId;
  draft: ScheduleDraft;
  settings: PublicSettings | null;
  runtime: RuntimeInfo | null;
  busy: boolean;
  hasActiveSchedule: boolean;
  /** When the saved schedule runs next, already worded for display. */
  nextRunText: string | null;
  onSave: (slice: ScheduleSave) => Promise<void>;
}) {
  const [local, setLocal] = useState<ScheduleSlice | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [webhookTesting, setWebhookTesting] = useState(false);
  const [webhookTestOk, setWebhookTestOk] = useState(false);
  const [webhookTestError, setWebhookTestError] = useState<string | null>(null);
  const [clock, setClock] = useState({ hour: "03", minute: "00" });
  const [timeError, setTimeError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDeleteConfirmOpen(false);
      setWebhookTestOk(false);
      setWebhookTestError(null);
      setTimeError(null);
      return;
    }
    const schedule: ScheduleSettings = {
      ...draft.schedule,
      mode: draft.schedule.mode === "off" ? "daily" : draft.schedule.mode,
    };
    setClock(scheduleTimeParts(schedule.time));
    setTimeError(null);
    setLocal({
      schedule,
      scan: structuredClone(draft.schedule.scan ?? draft.scan),
      webhookUrl: draft.webhookUrl,
      webhookEdited: false,
    });
  }, [open, draft]);

  function patchScan(patch: Partial<ScanSettings>) {
    setLocal((current) => (current ? { ...current, scan: { ...current.scan, ...patch } } : current));
  }

  function resetScheduleMatching() {
    patchScan(matchingDefaults(section, runtime?.suggestedParallelism));
  }

  async function apply() {
    if (!local) return;
    if (local.schedule.mode === "off") {
      // Off is the same as deleting the schedule, so it asks first. With nothing saved there is nothing to delete.
      if (hasActiveSchedule) setDeleteConfirmOpen(true);
      else onOpenChange(false);
      return;
    }
    const time = normalizeScheduleClock(clock.hour, clock.minute);
    if (!time) {
      setTimeError("Enter an hour from 00 to 23 and a minute from 00 to 59.");
      return;
    }
    setTimeError(null);
    const mode = local.schedule.mode;
    const webhookUrl = local.webhookUrl.trim();
    const clearWebhook =
      webhookUrl.length === 0 && local.webhookEdited && Boolean(settings?.webhookConfigured);
    await onSave({
      schedule: {
        ...local.schedule,
        mode,
        time,
        scan: { ...local.scan, includes: draft.scan.includes, excludes: draft.scan.excludes },
      },
      webhookUrl,
      clearWebhook,
    });
    onOpenChange(false);
  }

  async function testWebhook() {
    if (!local) return;
    const webhookUrl = local.webhookUrl.trim();
    if (!webhookUrl && !settings?.webhookConfigured) return;
    setWebhookTesting(true);
    setWebhookTestOk(false);
    setWebhookTestError(null);
    try {
      await api("/api/webhook/test", {
        method: "POST",
        body: JSON.stringify({
          section,
          webhookUrl: webhookUrl || undefined,
        }),
      });
      setWebhookTestOk(true);
    } catch (err) {
      setWebhookTestError(err instanceof Error ? err.message : "Could not send the test");
    } finally {
      setWebhookTesting(false);
    }
  }

  async function confirmDeleteSchedule() {
    await onSave({
      schedule: { ...draft.schedule, mode: "off" },
      webhookUrl: "",
      clearWebhook: true,
    });
    setDeleteConfirmOpen(false);
    onOpenChange(false);
  }

  const frequency = local ? frequencySummary(local.schedule, clock) : null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Schedule</SheetTitle>
            <SheetDescription>
              {sectionLabel(section)}
              {frequency ? ` · ${frequency}` : ""}
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            {local ? (
              <SettingsSteps
                steps={[
                  {
                    id: "frequency",
                    title: "Frequency",
                    summary: frequency,
                    content: (
                      <>
                        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Frequency">
                          <PillButton
                            selected={local.schedule.mode === "off"}
                            onClick={() => setLocal({ ...local, schedule: { ...local.schedule, mode: "off" } })}
                          >
                            Off
                          </PillButton>
                          <PillButton
                            selected={local.schedule.mode === "daily"}
                            onClick={() => setLocal({ ...local, schedule: { ...local.schedule, mode: "daily" } })}
                          >
                            Daily
                          </PillButton>
                          <PillButton
                            selected={local.schedule.mode === "weekly"}
                            onClick={() => setLocal({ ...local, schedule: { ...local.schedule, mode: "weekly" } })}
                          >
                            Weekly
                          </PillButton>
                        </div>
                        {local.schedule.mode === "off" ? (
                          <p className="text-xs text-muted-foreground">
                            {hasActiveSchedule ? "Saving with Off deletes the schedule and its webhook." : "Scans only run when you start them."}
                          </p>
                        ) : (
                          <ScheduleTimingRow
                            schedule={local.schedule}
                            hour={clock.hour}
                            minute={clock.minute}
                            timeError={timeError}
                            onClockChange={(next) => {
                              setTimeError(null);
                              setClock(next);
                            }}
                            onChange={(schedule) => setLocal({ ...local, schedule: { ...schedule, scan: local.scan } })}
                          />
                        )}
                        <p className="text-xs text-muted-foreground">Scheduled scans never stack, trash or delete anything.</p>
                        {local.schedule.mode !== "off" && hasActiveSchedule && nextRunText ? (
                          <p className="text-xs text-muted-foreground">
                            Next run {nextRunText}. If another scan is running then, it starts when that one finishes.
                          </p>
                        ) : null}
                      </>
                    ),
                  },
                  withReset(scanOptionsStep({ scan: local.scan, patch: patchScan, runtime }), resetScheduleMatching),
                  {
                    id: "webhook",
                    title: "Webhook",
                    summary: webhookSummary(local.webhookUrl, Boolean(settings?.webhookConfigured)),
                    content: (
                      <>
                        <label htmlFor="schedule-webhook" className="text-xs text-muted-foreground">Webhook URL</label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="schedule-webhook"
                            className={`min-w-0 flex-1 font-mono text-xs ${fieldClass}`}
                            placeholder={settings?.webhookConfigured ? "Saved. Enter a new URL to replace it." : "https://example.test/hook"}
                            value={local.webhookUrl}
                            onChange={(event) => {
                              setWebhookTestOk(false);
                              setWebhookTestError(null);
                              setLocal({ ...local, webhookUrl: event.target.value, webhookEdited: true });
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-[34px] shrink-0"
                            disabled={busy || webhookTesting || (!local.webhookUrl.trim() && !settings?.webhookConfigured)}
                            onClick={() => void testWebhook()}
                          >
                            {webhookTesting ? (
                              <>
                                <Loader2 className="size-3.5 animate-spin" />
                                Send test
                              </>
                            ) : (
                              "Send test"
                            )}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">Called when a scheduled scan finishes, not for scans you start yourself.</p>
                        {webhookTestOk ? <p className="text-xs text-muted-foreground">Test sent. The webhook responded.</p> : null}
                        {webhookTestError ? <p className="text-xs text-destructive">{webhookTestError}</p> : null}
                      </>
                    ),
                  },
                ]}
              />
            ) : null}
          </SheetBody>
          <SheetFooter className="justify-end px-[22px]">
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" className="h-9" onClick={() => void apply()} disabled={busy || !local}>
                Save schedule
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <Dialog open={deleteConfirmOpen} onOpenChange={(next) => !busy && setDeleteConfirmOpen(next)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete schedule?</DialogTitle>
            <DialogDescription>
              Scheduled scans will stop and the webhook will be removed. Your scan settings stay as they are.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirmDeleteSchedule()}>
              Delete schedule
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Every Sunday at 03:00 Europe/Zurich", as inputs. */
function ScheduleTimingRow({
  schedule,
  onChange,
  hour,
  minute,
  timeError,
  onClockChange,
}: {
  schedule: ScheduleSettings;
  onChange: (schedule: ScheduleSettings) => void;
  hour: string;
  minute: string;
  timeError: string | null;
  onClockChange: (clock: { hour: string; minute: string }) => void;
}) {
  const timeFieldClass = `${fieldClass} w-11 px-0.5 text-center font-semibold tabular-nums md:text-sm`;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Every</span>
        {schedule.mode === "weekly" ? (
          <select
            className={`${fieldClass} border px-2 [color-scheme:dark]`}
            aria-label="Weekday"
            value={schedule.weekday}
            onChange={(event) => onChange({ ...schedule, weekday: Number(event.target.value) })}
          >
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>{day}</option>
            ))}
          </select>
        ) : (
          <span>day</span>
        )}
        <span className="text-muted-foreground">at</span>
        <span className="flex items-center gap-0.5">
          <Input
            className={timeFieldClass}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            aria-label="Hour"
            aria-invalid={Boolean(timeError)}
            value={hour}
            onChange={(event) => onClockChange({ hour: event.target.value, minute })}
          />
          <span className="text-muted-foreground">:</span>
          <Input
            className={timeFieldClass}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            aria-label="Minute"
            aria-invalid={Boolean(timeError)}
            value={minute}
            onChange={(event) => onClockChange({ hour, minute: event.target.value })}
          />
        </span>
        <TimezonePicker
          value={schedule.timezone || "UTC"}
          onChange={(timezone) => onChange({ ...schedule, timezone })}
        />
      </div>
      {timeError ? <p className="text-xs text-destructive">{timeError}</p> : null}
    </div>
  );
}

function withReset(step: StepDef, onReset: () => void): StepDef {
  return {
    ...step,
    content: (
      <>
        {step.content}
        <Button type="button" size="xs" variant="ghost" className="h-7 gap-1 text-muted-foreground" onClick={onReset}>
          <RotateCcw className="size-3" />
          Reset defaults
        </Button>
      </>
    ),
  };
}

function frequencySummary(schedule: ScheduleSettings, clock: { hour: string; minute: string }): string {
  if (schedule.mode === "off") return "Off";
  const time = `${clock.hour}:${clock.minute}`;
  return schedule.mode === "weekly" ? `Weekly, ${WEEKDAYS[schedule.weekday] ?? ""} at ${time}` : `Daily at ${time}`;
}

function webhookSummary(typed: string, configured: boolean): string {
  const url = typed.trim();
  if (url) {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }
  return configured ? "Saved" : "None";
}

function scheduleTimeParts(time: string): { hour: string; minute: string } {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return { hour: "02", minute: "00" };
  return { hour: match[1], minute: match[2] };
}

function normalizeScheduleClock(hourText: string, minuteText: string): string | null {
  const hour = parseClockPart(hourText, 23);
  const minute = parseClockPart(minuteText, 59);
  if (hour == null || minute == null) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseClockPart(value: string, max: number): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (parsed > max) return null;
  return parsed;
}
