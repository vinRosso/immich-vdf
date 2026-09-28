import type { SectionId } from "@/lib/types";

/** User-facing name for a scan section (`server` is shown as Files). */
export function sectionLabel(section: SectionId): string {
  return section === "server" ? "Files" : "Immich";
}
