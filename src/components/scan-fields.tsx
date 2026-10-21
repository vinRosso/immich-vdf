"use client";

import { Check, Minus, Plus } from "lucide-react";
import { cn } from "cn";
import { HintWrap } from "@/components/folder-picker";
import type { StepDef } from "@/components/settings-steps";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { timeWindowHint } from "@/lib/time-window";
import type { RuntimeInfo, ScanSettings } from "@/lib/types";

const tileClass = "rounded-[10px] border border-border bg-secondary";
const bigNumberClass =
  "h-7 border-0 bg-transparent px-0 text-lg font-semibold text-foreground tabular-nums shadow-none focus-visible:border-0 focus-visible:ring-0 md:text-lg dark:bg-transparent";

/** A small "?" that shows the hint at once, in a tooltip that floats above the panel. */
function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Help"
          className="inline-grid size-4 shrink-0 cursor-help place-items-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs whitespace-normal">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A typed number with a slider under it and a caption at each end. */
function SliderTile({
  label,
  hint,
  value,
  min,
  max,
  suffix,
  lowCaption,
  highCaption,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  lowCaption: string;
  highCaption: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className={cn(tileClass, "flex flex-col gap-1.5 px-3 py-2.5")}>
      <div className="flex items-center justify-between gap-1.5 text-xs text-muted-foreground">
        <span>{label}</span>
        <HelpTip text={hint} />
      </div>
      <div className="flex items-baseline gap-0.5">
        <Input
          className={cn(bigNumberClass, suffix ? "w-9" : "w-12")}
          type="text"
          inputMode="numeric"
          aria-label={label}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={clamp(value, min, max)}
        aria-label={`${label} slider`}
        className="w-full accent-primary"
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{lowCaption}</span>
        <span>{highCaption}</span>
      </div>
    </div>
  );
}

/** A typed number between − and + buttons, with a caption underneath. */
function StepperTile({
  label,
  hint,
  value,
  min,
  max,
  step,
  unit,
  caption,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  caption: string;
  onChange: (value: number) => void;
}) {
  const buttonClass =
    "grid size-[30px] shrink-0 place-items-center rounded-lg border border-border bg-muted text-foreground outline-none hover:border-primary focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40";
  return (
    <div className={cn(tileClass, "flex flex-col gap-1.5 px-3 py-2.5")}>
      <div className="flex items-center justify-between gap-1.5 text-xs text-muted-foreground">
        <span>{label}</span>
        <HelpTip text={hint} />
      </div>
      <div className="flex items-center justify-between gap-1.5">
        <button type="button" aria-label={`Decrease ${label}`} className={buttonClass} disabled={value <= min} onClick={() => onChange(clamp(value - step, min, max))}>
          <Minus className="size-3.5" aria-hidden />
        </button>
        <span className="flex min-w-0 items-baseline justify-center">
          <Input
            className={cn(bigNumberClass, "w-auto min-w-6 text-right [field-sizing:content]")}
            type="text"
            inputMode="numeric"
            aria-label={label}
            value={value}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onChange(clamp(next, min, max));
            }}
          />
          <span className={cn("text-sm text-muted-foreground", value === 0 && "ml-1")}>{unit && value > 0 ? unit : min === 0 && value === 0 ? "Off" : ""}</span>
        </span>
        <button type="button" aria-label={`Increase ${label}`} className={buttonClass} disabled={value >= max} onClick={() => onChange(clamp(value + step, min, max))}>
          <Plus className="size-3.5" aria-hidden />
        </button>
      </div>
      <div className="text-[11px] text-muted-foreground">{caption}</div>
    </div>
  );
}

/** A switch shown as a tile with a check box, a short caption and a "?" for the full hint. */
function FlagTile({ label, caption, hint, checked, onChange }: { label: string; caption: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div
      className={cn(
        tileClass,
        "flex min-h-[3.25rem] items-center gap-2 px-2.5 py-2",
        checked ? "border-primary/60 bg-primary/10" : "hover:border-primary/45",
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          className={cn(
            "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-2",
            checked ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent",
          )}
        >
          <Check className="size-3 [stroke-width:3]" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[13px] font-medium">{label}</span>
          <span className="text-[11px] text-muted-foreground">{caption}</span>
        </span>
      </button>
      <HelpTip text={hint} />
    </div>
  );
}

/** A small labelled number, for the compact options in the schedule sheet. */
function MiniNumber({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (value: number) => void }) {
  return (
    <HintWrap text={hint} className="block">
      <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        {label}
        <Input
          className="h-7 w-full border-border bg-secondary px-2 text-xs tabular-nums text-foreground md:text-xs"
          type="text"
          inputMode="numeric"
          aria-label={label}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
      </label>
    </HintWrap>
  );
}

/** A switch shown as a small pill, for the compact options in the schedule sheet. */
function ChipFlag({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <HintWrap text={hint}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "min-h-[1.625rem] rounded-full border px-2.5 py-0.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          checked ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-secondary hover:border-primary/45",
        )}
      >
        {label}
      </button>
    </HintWrap>
  );
}

function parallelHint(runtime: RuntimeInfo | null): string {
  return runtime
    ? `How many files are processed at once. This machine has ${runtime.cpuCount} cores. Suggested: ${runtime.suggestedParallelism}. Maximum: ${runtime.maxParallelism}.`
    : "How many files are processed at once.";
}

const THRESHOLD_HINT = "How different two files can look and still match, from 0 to 10. Lower is stricter.";
const PERCENT_HINT = "How alike two files must be to count as duplicates. Higher finds fewer, closer matches.";
const BURST_HINT =
  "Also group photos taken within this many seconds of each other that share a file-name prefix. 0 turns this off.";

const FLAGS = [
  { key: "includeImages", label: "Images", caption: "photos as well as video", hint: "Also look for duplicate photos, not just videos." },
  {
    key: "compareHorizontallyFlipped",
    label: "Mirrored",
    caption: "about 2× slower",
    hint: "Also finds copies that were flipped left to right. Makes scans about twice as slow.",
  },
  {
    key: "aiMatching",
    label: "AI match",
    caption: "one-time 100 MB download",
    hint: "Finds cropped, mirrored or heavily edited copies. Downloads about 100 MB the first time you use it.",
  },
  { key: "aiPartial", label: "AI partial", caption: "clips, picture only", hint: "Finds clips cut from longer videos by looking at the picture alone. Downloads extra files the first time you use it." },
  { key: "partialClip", label: "Partial clips", caption: "matches by sound, slow", hint: "Finds a clip inside a longer file by matching its audio. Slow." },
] as const;

const PHASH = { key: "usePhash", label: "pHash", caption: "alternative method", hint: "Compares pictures a different way. Try it if the default misses duplicates." } as const;

type Fields = { scan: ScanSettings; patch: (patch: Partial<ScanSettings>) => void; runtime: RuntimeInfo | null };

const grid = "grid grid-cols-2 gap-2";

function windowSummary(scan: ScanSettings): string {
  return scan.timeWindowDays ? `${scan.timeWindowDays}d window` : "No window";
}

/** The matching options as steps for the scan settings sheet (after the starting point). */
export function scanSteps({ scan, patch, runtime }: Fields): StepDef[] {
  const on = FLAGS.filter((flag) => scan[flag.key]).map((flag) => flag.label);
  return [
    {
      id: "strict",
      title: "How strict",
      summary: `${scan.percent}% · tolerance ${scan.threshold}`,
      content: (
        <div className={grid}>
          <SliderTile
            label="Similarity"
            hint={PERCENT_HINT}
            value={scan.percent}
            min={50}
            max={100}
            suffix="%"
            lowCaption="more matches"
            highCaption="fewer"
            onChange={(percent) => patch({ percent })}
          />
          <SliderTile
            label="Hash tolerance"
            hint={THRESHOLD_HINT}
            value={scan.threshold}
            min={0}
            max={10}
            lowCaption="strict"
            highCaption="loose"
            onChange={(threshold) => patch({ threshold })}
          />
        </div>
      ),
    },
    {
      id: "find",
      title: "What to look for",
      summary: on.length ? on.join(", ") : "Video only",
      content: (
        <div className={grid}>
          {FLAGS.map((flag) => (
            <FlagTile
              key={flag.key}
              label={flag.label}
              caption={flag.caption}
              hint={flag.hint}
              checked={scan[flag.key]}
              onChange={(value) => patch({ [flag.key]: value })}
            />
          ))}
        </div>
      ),
    },
    {
      id: "time",
      title: "Grouping by time",
      summary: `${windowSummary(scan)} · ${scan.prefixSeconds ? `bursts ${scan.prefixSeconds}s` : "no bursts"}`,
      content: (
        <div className={grid}>
          <StepperTile
            label="Time window"
            hint={timeWindowHint(scan.timeWindowDays)}
            value={scan.timeWindowDays}
            min={0}
            max={365}
            step={5}
            unit="d"
            caption={scan.timeWindowDays ? "nearby dates only" : "any date can match"}
            onChange={(timeWindowDays) => patch({ timeWindowDays })}
          />
          <StepperTile
            label="Bursts"
            hint={BURST_HINT}
            value={scan.prefixSeconds}
            min={0}
            max={60}
            step={1}
            unit="s"
            caption="photos shot in a row"
            onChange={(prefixSeconds) => patch({ prefixSeconds })}
          />
        </div>
      ),
    },
    {
      id: "advanced",
      title: "Advanced",
      summary: `${scan.parallelism} at once${scan.usePhash ? " · pHash" : ""}`,
      content: (
        <div className={grid}>
          <StepperTile
            label="Parallel jobs"
            hint={parallelHint(runtime)}
            value={scan.parallelism}
            min={1}
            max={runtime?.maxParallelism ?? 32}
            step={1}
            caption={runtime ? `${runtime.suggestedParallelism} suggested` : "files at once"}
            onChange={(parallelism) => patch({ parallelism })}
          />
          <FlagTile label={PHASH.label} caption={PHASH.caption} hint={PHASH.hint} checked={scan.usePhash} onChange={(usePhash) => patch({ usePhash })} />
        </div>
      ),
    },
  ];
}

/** All matching options in one compact step, for the schedule sheet. */
export function scanOptionsStep({ scan, patch, runtime }: Fields): StepDef {
  return {
    id: "settings",
    title: "Settings",
    summary: `${scan.percent}% · ${windowSummary(scan).toLowerCase()}`,
    content: (
      <>
        <p className="text-xs text-muted-foreground">Scheduled scans use these settings, not the ones on the page.</p>
        <div className={grid}>
          <MiniNumber label="Similarity" hint={PERCENT_HINT} value={scan.percent} onChange={(percent) => patch({ percent })} />
          <MiniNumber label="Hash tolerance" hint={THRESHOLD_HINT} value={scan.threshold} onChange={(threshold) => patch({ threshold })} />
          <MiniNumber label="Time window" hint={timeWindowHint(scan.timeWindowDays)} value={scan.timeWindowDays} onChange={(timeWindowDays) => patch({ timeWindowDays })} />
          <MiniNumber label="Bursts" hint={BURST_HINT} value={scan.prefixSeconds} onChange={(prefixSeconds) => patch({ prefixSeconds })} />
          <MiniNumber label="Parallel jobs" hint={parallelHint(runtime)} value={scan.parallelism} onChange={(parallelism) => patch({ parallelism })} />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="What to look for">
          {FLAGS.map((flag) => (
            <ChipFlag key={flag.key} label={flag.label} hint={flag.hint} checked={scan[flag.key]} onChange={(value) => patch({ [flag.key]: value })} />
          ))}
          <ChipFlag label={PHASH.label} hint={PHASH.hint} checked={scan.usePhash} onChange={(usePhash) => patch({ usePhash })} />
        </div>
      </>
    ),
  };
}
