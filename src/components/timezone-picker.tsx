"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { formatTimeZone, listTimeZones, timeZoneMatches } from "@/lib/time-zones";

export function TimezonePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (zone: string) => void;
}) {
  const zones = useMemo(() => listTimeZones(), []);
  const selected = zones.includes(value) ? value : value || "UTC";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(
    () => (query.trim() ? zones.filter((zone) => timeZoneMatches(zone, query)) : zones),
    [zones, query],
  );

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ block: "nearest" });
  }, [open, active, matches]);

  function choose(zone: string) {
    onChange(zone);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        aria-label="Timezone"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls="timezone-options"
        className="h-7 w-56 rounded-md border-0 bg-transparent px-0.5 text-sm font-semibold text-foreground underline decoration-muted-foreground/50 underline-offset-4 outline-none placeholder:font-normal placeholder:text-muted-foreground hover:decoration-foreground focus-visible:decoration-foreground"
        value={open ? query : formatTimeZone(selected)}
        placeholder="Search timezones"
        onMouseDown={() => setOpen(true)}
        onFocus={(event) => {
          event.currentTarget.select();
          setQuery("");
          setActive(Math.max(0, zones.indexOf(selected)));
          setOpen(true);
        }}
        onChange={(event) => {
          const label = formatTimeZone(selected);
          const typed = event.target.value;
          const next = !open && typed.startsWith(label) ? typed.slice(label.length) : typed;
          setQuery(next);
          setActive(0);
          setOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(matches.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            const zone = matches[active];
            if (zone) choose(zone);
          } else if (event.key === "Escape") {
            setQuery("");
            setOpen(false);
          }
        }}
      />
      {open ? (
        <ul
          id="timezone-options"
          ref={listRef}
          role="listbox"
          className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-72 overflow-y-auto rounded-md bg-popover py-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/15"
        >
          {matches.length === 0 ? (
            <li className="px-2 py-1.5 text-muted-foreground">No matching timezone</li>
          ) : (
            matches.map((zone, index) => (
              <li key={zone}>
                <button
                  type="button"
                  role="option"
                  aria-selected={zone === selected}
                  data-active={index === active}
                  className={cn(
                    "flex w-full px-2 py-1 text-left",
                    index === active && "bg-muted",
                    zone === selected && "font-semibold text-primary",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(zone)}
                >
                  {formatTimeZone(zone)}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
