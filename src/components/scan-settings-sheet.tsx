"use client";

import { scanSteps } from "@/components/scan-fields";
import { PillButton, SettingsSteps } from "@/components/settings-steps";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { sectionLabel } from "@/lib/section-label";
import { SCAN_PROFILES, applyScanProfile, detectScanProfile } from "@/lib/scan-profiles";
import type { RuntimeInfo, ScanSettings, SectionId } from "@/lib/types";

/** Profile name for the current settings, or "Custom" when they match no profile. */
export function scanProfileLabel(scan: ScanSettings): string {
  const id = detectScanProfile(scan);
  return SCAN_PROFILES.find((profile) => profile.id === id)?.name ?? "Custom";
}

/** One line for the row that opens the sheet. */
export function scanSettingsSummary(scan: ScanSettings): string {
  return `${scanProfileLabel(scan)} · ${scan.percent}% · ${scan.timeWindowDays ? `${scan.timeWindowDays}d window` : "no window"}`;
}

export function ScanSettingsSheet({
  open,
  onOpenChange,
  section,
  scan,
  onChange,
  runtime,
  busy,
  canScan,
  onReset,
  onSave,
  onSaveAndScan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SectionId;
  scan: ScanSettings;
  onChange: (scan: ScanSettings) => void;
  runtime: RuntimeInfo | null;
  busy: boolean;
  canScan: boolean;
  onReset: () => void;
  onSave: () => void;
  onSaveAndScan: () => void;
}) {
  const active = detectScanProfile(scan);
  const activeProfile = SCAN_PROFILES.find((profile) => profile.id === active);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Scan settings</SheetTitle>
          <SheetDescription>
            {sectionLabel(section)} · {activeProfile ? `preset: ${activeProfile.name}` : "Custom settings"}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <SettingsSteps
            steps={[
              {
                id: "start",
                title: "Starting point",
                summary: scanProfileLabel(scan),
                content: (
                  <>
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Starting point">
                      {SCAN_PROFILES.map((profile) => (
                        <PillButton key={profile.id} selected={active === profile.id} onClick={() => onChange(applyScanProfile(scan, profile.id))}>
                          {profile.name}
                        </PillButton>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {activeProfile ? activeProfile.hint : "Your own settings. Pick a preset to replace them."}
                    </p>
                  </>
                ),
              },
              ...scanSteps({ scan, patch: (patch) => onChange({ ...scan, ...patch }), runtime }),
            ]}
          />
        </SheetBody>
        <SheetFooter className="px-[22px]">
          <Button type="button" variant="outline" className="h-9" onClick={onReset}>
            Reset defaults
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-9" disabled={busy} onClick={onSave}>
              Save
            </Button>
            <Button type="button" className="h-9" disabled={busy || !canScan} onClick={onSaveAndScan}>
              Save and scan
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
