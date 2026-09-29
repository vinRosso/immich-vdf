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
  hint,
  values,
  onChange,
}: {
  section: SectionId;
  label: string;
  hint: string;
  values: string[];
  onChange: (values: string[]) => void;
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
    <HintWrap text={hint} className="flex min-w-0 flex-wrap items-center gap-2">
      <Button type="button" size="xs" variant="outline" onClick={() => setOpen(true)}>
        Browse
      </Button>
      <span className="shrink-0 text-xs">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {chosen.map((path) => (
          <Tooltip key={path}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex max-w-[12rem] truncate rounded-md bg-muted/70 px-2 py-0.5 font-mono text-[11px] hover:bg-destructive/15 hover:text-destructive"
                onClick={() => remove(path)}
              >
                {folderName(path)}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[min(36rem,calc(100vw-2rem))] font-mono whitespace-normal break-all">
              {path}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{listing?.current ?? "Choose a mounted folder."}</DialogDescription>
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
    </HintWrap>
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
      <TooltipContent side="top" className="max-w-sm whitespace-normal">{text}</TooltipContent>
    </Tooltip>
  );
}
