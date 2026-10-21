"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { cn } from "cn";
import { api } from "@/components/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SectionId } from "@/lib/types";

type Listing = {
  current: string | null;
  parent: string | null;
  dirs: { name: string; path: string }[];
};

function folderName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

export function FolderPicker({
  section,
  label,
  dialogTitle,
  hint,
  values,
  onChange,
  dashed = false,
}: {
  section: SectionId;
  label: string;
  /** Title of the Browse dialog. Defaults to `label`. */
  dialogTitle?: string;
  hint: string;
  values: string[];
  onChange: (values: string[]) => void;
  /** Dashed chips mark the exclude list. */
  dashed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = values.map((value) => value.trim()).filter(Boolean);

  function load(path: string | null) {
    setError(null);
    const query = path ? `&path=${encodeURIComponent(path)}` : "";
    void api<Listing>(`/api/folders?section=${section}${query}`)
      .then(setListing)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not list folders"));
  }

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    load(null);
  }, [open, section]);

  function add(path: string) {
    if (chosen.some((value) => value === path)) return;
    onChange([...chosen, path]);
  }

  function addFromDialog(event: MouseEvent, path: string) {
    event.preventDefault();
    add(path);
  }

  function remove(path: string) {
    onChange(chosen.filter((value) => value !== path));
  }

  return (
    <div className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-start gap-2 text-xs">
      <HintWrap text={hint} className="pt-1 text-muted-foreground">
        {label}
      </HintWrap>
      <div className="flex min-w-0 flex-wrap gap-1">
        {chosen.map((path) => (
          <Tooltip key={path}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-[7px] border border-border bg-secondary py-0.5 pr-1.5 pl-2 font-mono text-[11px] hover:border-destructive hover:text-destructive",
                  dashed && "border-dashed",
                )}
                onClick={() => remove(path)}
              >
                <span className="min-w-0 truncate">{folderName(path)}</span>
                <span className="shrink-0 opacity-60" aria-hidden>×</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[min(36rem,calc(100vw-2rem))] font-mono whitespace-normal break-all">
              {path}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <Button type="button" size="xs" variant="outline" onClick={() => setOpen(true)}>
        Browse
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{dialogTitle ?? label}</DialogTitle>
            <DialogDescription>{listing?.current ?? "Choose a folder."}</DialogDescription>
          </DialogHeader>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={!listing || listing.current === null} onClick={() => listing && load(listing.parent)}>
              Up
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!listing?.current}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => listing?.current && addFromDialog(event, listing.current)}
            >
              Add this folder
            </Button>
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto overscroll-contain [scrollbar-width:thin] [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-button]:size-0">
            {listing?.dirs.map((dir) => (
              <li key={dir.path} className="flex items-center gap-2">
                <button type="button" className="min-w-0 flex-1 truncate text-left text-sm hover:text-primary" onClick={() => load(dir.path)}>
                  {dir.name}
                </button>
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => addFromDialog(event, dir.path)}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Shows `text` when the user hovers the wrapped label or control. */
export function HintWrap({ text, children, className }: { text: string; children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("cursor-help", className)} tabIndex={0}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-sm whitespace-normal">{text}</TooltipContent>
    </Tooltip>
  );
}
