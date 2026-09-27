"use client";

import { Hint } from "@/components/folder-picker";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SCAN_PROFILES, applyScanProfile, detectScanProfile } from "@/lib/scan-profiles";
import type { ScanSettings } from "@/lib/types";

export function ScanProfilePicker({
  scan,
  onChange,
}: {
  scan: ScanSettings;
  onChange: (scan: ScanSettings) => void;
}) {
  const active = detectScanProfile(scan);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 pb-0.5">
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
        <span className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
          Custom
          <Hint text="Your settings do not match a scan preset. Adjust the controls below or pick a preset." />
        </span>
      ) : null}
    </div>
  );
}
