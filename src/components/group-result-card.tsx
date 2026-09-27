import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import type { ClientGroup, SectionId } from "@/lib/types";

export function ResultGroupCard({
  section,
  group,
  onSelect,
  topRight,
}: {
  section: SectionId;
  group: ClientGroup;
  onSelect: () => void;
  topRight: ReactNode;
}) {
  const best = group.items.find((item) => item.isPrimary) ?? group.items[0];
  return (
    <div className="group/card relative overflow-hidden rounded-xl bg-black ring-1 ring-foreground/10 transition hover:ring-primary/60">
      <button type="button" onClick={onSelect} className="block w-full text-left">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" src={posterSrc(section, best)} className="aspect-[4/3] w-full object-cover" />
        <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent px-3 pt-10 pb-2.5 text-sm text-white">
          <span className="tabular-nums">{similarityRange(group)}</span>
          <span className="tabular-nums">{formatBytes(group.items.reduce((sum, item) => sum + item.sizeBytes, 0))}</span>
        </span>
      </button>
      <span className="pointer-events-none absolute top-2 left-2 flex size-[1.875rem] items-center justify-center rounded-full bg-background/90 text-xs font-semibold tabular-nums text-foreground shadow-sm">
        {group.items.length}
      </span>
      <div className="absolute top-2 right-2" onClick={(event) => event.stopPropagation()}>
        {topRight}
      </div>
    </div>
  );
}

export function posterSrc(section: SectionId, item: ClientGroup["items"][number]): string {
  if (section === "immich" && item.assetId) return `/api/immich-thumb?id=${encodeURIComponent(item.assetId)}`;
  return `/api/thumbs?section=server&path=${encodeURIComponent(item.path)}&kind=poster`;
}

export function similarityRange(group: ClientGroup): string {
  const values = group.items.map((item) => item.similarity);
  const min = Math.round(Math.min(...values));
  const max = Math.round(Math.max(...values));
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "—";
  if (min === max) return `${max}%`;
  return `${min}%–${max}%`;
}

export function RestoreGroupButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" size="xs" variant="secondary" className="bg-background/90 shadow-sm" onClick={onClick}>
      Restore
    </Button>
  );
}
