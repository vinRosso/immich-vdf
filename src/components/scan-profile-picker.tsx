"use client";

import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SCAN_PROFILES, applyScanProfile, detectScanProfile } from "@/lib/scan-profiles";
import type { ScanSettings } from "@/lib/types";

export function ScanProfilePicker({
  scan,
  onChange,
  className,
}: {
  scan: ScanSettings;
  onChange: (scan: ScanSettings) => void;
  className?: string;
}) {
  const active = detectScanProfile(scan);

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5 pb-0.5", className)}>
      {SCAN_PROFILES.map((profile) => {
        const selected = active === profile.id;
        return (
          <Tooltip key={profile.id}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="xs"
                variant={selected ? "secondary" : "outline"}
                className="gap-1"
                onClick={() => onChange(applyScanProfile(scan, profile.id))}
              >
                {profile.name}
                {profile.badge ? <span className="text-[10px] font-normal text-muted-foreground">({profile.badge})</span> : null}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{profile.hint}</TooltipContent>
          </Tooltip>
        );
      })}
      {active === "custom" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help px-1 text-xs text-muted-foreground" tabIndex={0}>
              Custom
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-sm whitespace-normal">
            Your settings do not match a scan preset. Adjust the controls below or pick a preset.
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
