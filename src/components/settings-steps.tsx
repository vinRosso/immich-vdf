"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

/** A rounded pill that toggles one choice, used for the starting point and the schedule frequency. */
export function PillButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "min-h-8 rounded-full border px-3 py-1.5 text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-secondary hover:border-primary/45",
      )}
    >
      {children}
    </button>
  );
}

export type StepDef = {
  id: string;
  title: string;
  /** One line shown to the right of the title while the step is closed or open. */
  summary?: ReactNode;
  content: ReactNode;
};

/** Numbered sections where one is open at a time. Used by the scan settings and schedule sheets. */
export function SettingsSteps({ steps, defaultOpen }: { steps: StepDef[]; defaultOpen?: string }) {
  const [open, setOpen] = useState<string | null>(defaultOpen ?? steps[0]?.id ?? null);
  return (
    <ol className="space-y-2 p-4">
      {steps.map((step, index) => {
        const isOpen = open === step.id;
        return (
          <li
            key={step.id}
            className={cn(
              "rounded-xl border bg-muted/60",
              isOpen ? "border-primary/45" : "border-border",
            )}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              className="flex min-h-13 w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left outline-none hover:bg-white/[0.03] focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => setOpen(isOpen ? null : step.id)}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  isOpen ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
                )}
              >
                {index + 1}
              </span>
              <span className="shrink-0 text-sm font-semibold">{step.title}</span>
              <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">{step.summary}</span>
              <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden />
            </button>
            {isOpen ? (
              <div className="space-y-3 px-3.5 pt-4 pb-3.5 pl-[3.25rem]">
                {step.content}
                {steps[index + 1] ? (
                  <div className="flex justify-end">
                    <Button type="button" size="xs" variant="outline" onClick={() => setOpen(steps[index + 1].id)}>
                      Next: {steps[index + 1].title}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
