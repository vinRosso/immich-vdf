"use client";

import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/format";
import { useTrashSaved } from "@/lib/use-trash-saved";

/**
 * Space saved so far, split into Immich trash and `.vdf-trash`. Links to the trash page, like the header pill it replaces.
 * `home` words the second line and the legend for the home page; `library` for the section pages.
 */
export function SpaceFreedCard({ variant = "library", className }: { variant?: "home" | "library"; className?: string }) {
  const { saved, failed } = useTrashSaved();
  if (saved === null) {
    if (failed) return null;
    return <Skeleton className={cn("h-[8.25rem] w-full rounded-[14px]", className)} aria-label="Loading saved space" />;
  }
  const immich = Math.max(0, saved.immichBytesTrashed);
  const files = Math.max(0, saved.bytesFreed);
  const total = immich + files;
  const immichShare = total > 0 ? (immich / total) * 100 : 0;
  const filesShare = total > 0 ? (files / total) * 100 : 0;
  return (
    <a
      href="/trash"
      title="Space freed by trashed duplicates"
      className={cn(
        "flex w-full flex-col gap-2 rounded-[14px] border border-white/[0.08] bg-gradient-to-b from-white/[0.035] to-white/[0.01] px-4 py-3.5",
        "transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>Space freed so far</span>
        <span>{variant === "home" ? "Immich and Files" : "all libraries"}</span>
      </span>
      <span className="font-heading text-[1.75rem] leading-[1.05] tabular-nums">{formatBytes(saved.savedBytes)}</span>
      <span className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden>
        <span className="h-full bg-primary" style={{ width: `${immichShare}%` }} />
        <span className="h-full border-l-2 border-background" style={{ width: `${filesShare}%`, backgroundColor: "oklch(0.7 0.12 250)" }} />
      </span>
      <span className="flex justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block size-[7px] rounded-[2px] bg-primary" aria-hidden />
          Immich {formatBytes(immich)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block size-[7px] rounded-[2px]" style={{ backgroundColor: "oklch(0.7 0.12 250)" }} aria-hidden />
          Files {formatBytes(files)}
        </span>
      </span>
    </a>
  );
}
