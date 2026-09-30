import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Layers, Merge } from "lucide-react";
import type { GroupDragBind } from "@/components/use-group-merge-drag";
import { ThumbnailSkeleton } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import { groupHasImmichArchived } from "@/lib/immich-archived";
import type { ClientGroup, SectionId } from "@/lib/types";

export function ResultGroupCard({
  section,
  group,
  onSelect,
  topRight,
  dragging = false,
  dropTarget = false,
  dragBind,
}: {
  section: SectionId;
  group: ClientGroup;
  onSelect: () => void;
  topRight: ReactNode;
  dragging?: boolean;
  dropTarget?: boolean;
  dragBind?: GroupDragBind;
}) {
  const best = group.items.find((item) => item.isPrimary) ?? group.items[0];
  const blurPoster = groupHasImmichArchived(section, group);
  return (
    <div
      className={[
        "group/card relative h-full overflow-hidden rounded-xl bg-black transition",
        dropTarget ? "z-10 ring-2 ring-primary" : "ring-1 ring-foreground/10 hover:ring-primary/60",
        dragging ? "opacity-40" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onDragOver={dragBind?.onDragOver}
      onDrop={dragBind?.onDrop}
    >
      <div
        {...dragBind}
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
        title={dragBind ? "Drag onto another group to merge" : undefined}
        className={dragBind ? "block w-full cursor-grab select-none text-left" : "block w-full text-left"}
      >
        <PosterImage src={posterSrc(section, best)} sensitive={blurPoster} />
        <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent px-3 pt-10 pb-2.5 text-sm text-white">
          <span className="tabular-nums">{similarityRange(group)}</span>
          <span className="tabular-nums">{formatBytes(group.items.reduce((sum, item) => sum + item.sizeBytes, 0))}</span>
        </span>
      </div>
      <span className="pointer-events-none absolute top-2 left-2 flex size-[1.875rem] items-center justify-center rounded-full bg-background/90 text-xs font-semibold tabular-nums text-foreground shadow-sm">
        {group.items.length}
      </span>
      {group.items.some((item) => item.stackId) ? (
        <span
          title="Stack"
          className="pointer-events-none absolute top-2 left-12 flex size-[1.875rem] items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm"
        >
          <Layers className="size-3.5" aria-hidden />
          <span className="sr-only">Stack</span>
        </span>
      ) : null}
      {blurPoster ? (
        <span className="pointer-events-none absolute top-10 left-2 rounded-full bg-background/90 px-2 py-1 text-[10px] font-semibold tracking-wide text-foreground uppercase shadow-sm">
          Archived
        </span>
      ) : null}
      {dropTarget ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-2xl ring-4 ring-background/90 transition-transform scale-110">
            <Merge className="size-7 stroke-[2.5]" aria-hidden />
            <span className="sr-only">Merge</span>
          </span>
        </span>
      ) : null}
      <div className="absolute top-2 right-2" data-no-drag onClick={(event) => event.stopPropagation()}>
        {topRight}
      </div>
    </div>
  );
}

function PosterImage({ src, sensitive = false }: { src: string; sensitive?: boolean }) {
  const [ready, setReady] = useState(false);
  return (
    <span className="relative block aspect-[4/3] w-full overflow-hidden bg-black">
      {!ready ? <ThumbnailSkeleton /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        draggable={false}
        src={src}
        onLoad={() => setReady(true)}
        onError={() => setReady(true)}
        className={
          ready
            ? sensitive
              ? "aspect-[4/3] w-full scale-110 object-cover blur-2xl"
              : "aspect-[4/3] w-full object-cover"
            : sensitive
              ? "aspect-[4/3] w-full scale-110 object-cover opacity-0 blur-2xl"
              : "aspect-[4/3] w-full object-cover opacity-0"
        }
      />
    </span>
  );
}

export function posterSrc(section: SectionId, item: { path: string; assetId?: string | null }): string {
  if (section === "immich" && item.assetId) return `/api/immich-thumb?id=${encodeURIComponent(item.assetId)}`;
  return `/api/thumbs?section=${section}&path=${encodeURIComponent(item.path)}&kind=poster`;
}

export function similarityRange(group: ClientGroup): string {
  const values = group.items.map((item) => item.similarity).filter((value) => Number.isFinite(value));
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
