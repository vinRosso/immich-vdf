"use client";

import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type RefObject, type SyntheticEvent } from "react";
import { cn } from "cn";
import { api } from "@/components/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { STRIP_FRAMES, sampleTimes } from "@/lib/ffmpeg-args";
import { formatBytes, formatDuration, formatPercent } from "@/lib/format";
import { clampImageView, fitImage, zoomImage, type ImageBounds, type ImageView } from "@/lib/image-view";
import { driftAction } from "@/lib/playback-sync";
import { likelyDirectPlayback } from "@/lib/playback";
import { pickPrimaryIndex, pickSmallestIndex } from "@/lib/primary";
import type { ClientGroup, ClientItem, MediaInfo, SectionId } from "@/lib/types";
import { ChevronLeft, ChevronRight, Star, XIcon } from "lucide-react";

const ITEM_DRAG_TYPE = "application/x-vdf-item";

const BLEND_MODES = [
  ["difference", "Difference"],
  ["exclusion", "Exclusion"],
  ["multiply", "Multiply"],
  ["screen", "Screen"],
  ["overlay", "Overlay"],
  ["darken", "Darken"],
  ["lighten", "Lighten"],
] as const;

type BlendMode = (typeof BLEND_MODES)[number][0];

type ImageCompare = {
  referenceSrc: string | null;
  referenceNumber: number | null;
  blend: BlendMode;
  resetKey: string;
  onBlend: (blend: BlendMode) => void;
  onClearReference: () => void;
  onDropIndex: (index: number) => void;
};

export function Viewer({
  section,
  group,
  index,
  total,
  onPrev,
  onNext,
  onClose,
  onChanged,
  ignoredKey = null,
}: {
  section: SectionId;
  group: ClientGroup | null;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onChanged: () => void;
  /** When set, the group is on the archived list and the header action restores it. */
  ignoredKey?: string | null;
}) {
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(1);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [referenceIndex, setReferenceIndex] = useState<number | null>(null);
  const [blend, setBlend] = useState<BlendMode>("difference");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const canPrev = index > 0;
  const canNext = index >= 0 && index < total - 1;

  useEffect(() => {
    setLeft(0);
    setRight(group && group.items.length > 1 ? 1 : 0);
    setPreviewIndex(0);
    setSelected(new Set());
    setReferenceIndex(null);
    setBlend("difference");
    setError(null);
  }, [group]);

  const imageOnly = Boolean(group?.items.length && group.items.every((item) => item.isImage));

  useEffect(() => {
    if (!group?.items.length) return;
    const items = group.items;
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      if (event.key === "ArrowLeft" && canPrev) {
        event.preventDefault();
        onPrev();
      } else if (event.key === "ArrowRight" && canNext) {
        event.preventDefault();
        onNext();
      } else if (imageOnly && event.key >= "0" && event.key <= "9") {
        const next = previewIndexFromDigit(items, event.key);
        if (next !== null) {
          event.preventDefault();
          setPreviewIndex(next);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [group, imageOnly, canPrev, canNext, onPrev, onNext]);

  const sync = usePlaybackPair();
  const leftItem = group?.items[left] ?? null;
  const rightItem = group?.items[right] ?? null;
  const previewItem = group?.items[previewIndex] ?? null;

  useEffect(() => {
    sync.reset();
  }, [group, sync]);

  async function act(label: string, url: string, body: unknown, close: boolean, method: "POST" | "DELETE" = "POST") {
    setPending(label);
    setError(null);
    try {
      await api(url, { method, body: JSON.stringify(body) });
      onChanged();
      if (close) onClose();
      else setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending(null);
    }
  }

  function keepOne(item: ClientItem | undefined) {
    if (!group || !item) return;
    if (section === "immich" && !item.assetId) {
      setError("That file is not a matched Immich asset");
      return;
    }
    void act(
      "Trash",
      section === "server" ? "/api/trash" : "/api/immich/trash",
      section === "server" ? { groupId: group.groupId, keepPath: item.path } : { groupId: group.groupId, keepId: item.assetId },
      true,
    );
  }

  function trashChosen(mode: "keep" | "trash") {
    if (!group) return;
    const chosen = group.items.filter((item) => selected.has(item.path));
    const victims = mode === "keep" ? group.items.filter((item) => !selected.has(item.path)) : chosen;
    if (victims.length === 0 || victims.length === group.items.length) return;
    if (section === "immich" && victims.some((item) => !item.assetId)) {
      setError("A selected file is not a matched Immich asset");
      return;
    }
    void act(
      "Trash",
      section === "server" ? "/api/trash" : "/api/immich/trash",
      section === "server"
        ? { groupId: group.groupId, trashPaths: victims.map((item) => item.path) }
        : { groupId: group.groupId, trashIds: victims.map((item) => item.assetId) },
      group.items.length - victims.length < 2,
    );
  }

  function selectPreview(itemIndex: number) {
    if (imageOnly) {
      setPreviewIndex(itemIndex);
      return;
    }
    if (itemIndex === left) {
      if (right !== left) {
        setLeft(right);
        setRight(itemIndex);
      }
      return;
    }
    setRight(itemIndex);
  }

  function toggleSelected(path: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const selectionBusy = Boolean(pending) || selected.size === 0 || (group !== null && selected.size === group.items.length);
  const bestItem = group ? group.items[pickPrimaryIndex(group.items)] : undefined;
  const smallestItem = group ? group.items[pickSmallestIndex(group.items)] : undefined;

  return (
    <Dialog open={Boolean(group)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="flex h-[calc(100dvh-2.5rem)] w-[calc(100vw-8rem)] max-w-none flex-col gap-3 overflow-visible p-4 sm:max-w-none">
        <Button type="button" variant="secondary" size="icon-lg" disabled={!canPrev} onClick={onPrev} aria-label="Previous group" className="absolute top-1/2 -left-12 -translate-y-1/2 shadow-md">
          <ChevronLeft />
        </Button>
        <Button type="button" variant="secondary" size="icon-lg" disabled={!canNext} onClick={onNext} aria-label="Next group" className="absolute top-1/2 -right-12 -translate-y-1/2 shadow-md">
          <ChevronRight />
        </Button>
        <DialogHeader className="relative flex-row flex-wrap items-center gap-3 pr-10">
          <DialogClose asChild>
            <Button type="button" variant="secondary" size="icon-sm" aria-label="Close" className="absolute top-0 right-0 shadow-sm">
              <XIcon />
            </Button>
          </DialogClose>
          <DialogTitle className="sr-only">Compare group</DialogTitle>
          {index >= 0 ? <DialogDescription className="shrink-0 text-left">{`Group ${index + 1} of ${total}`}</DialogDescription> : null}
          <div className="flex min-w-0 flex-1 flex-wrap justify-center gap-2">
            <Button type="button" size="sm" disabled={Boolean(pending)} onClick={() => keepOne(bestItem)}>
              Keep best
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={Boolean(pending)} onClick={() => keepOne(smallestItem)}>
              Keep smallest
            </Button>
            {ignoredKey ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(pending)}
                onClick={() => void act("Restore", "/api/ignore", { section, key: ignoredKey }, true, "DELETE")}
              >
                Restore group
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(pending) || !group}
                onClick={() => group && void act("Ignore", "/api/ignore", { section, groupId: group.groupId }, true)}
              >
                Archive group
              </Button>
            )}
          </div>
        </DialogHeader>
        {group && (imageOnly ? previewItem : leftItem && rightItem) ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {imageOnly && previewItem ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <Player
                  section={section}
                  item={previewItem}
                  other={previewItem}
                  side="left"
                  sync={sync}
                  soloImage
                  itemNumber={previewIndex + 1}
                  groupItems={group.items}
                  imageCompare={{
                    referenceSrc:
                      referenceIndex !== null && group.items[referenceIndex]
                        ? compareImageSrc(section, group.items[referenceIndex].path)
                        : null,
                    referenceNumber: referenceIndex !== null && group.items[referenceIndex] ? referenceIndex + 1 : null,
                    blend,
                    resetKey: group.groupId,
                    onBlend: setBlend,
                    onClearReference: () => setReferenceIndex(null),
                    onDropIndex: (itemIndex) => {
                      if (itemIndex >= 0 && itemIndex < group.items.length) setReferenceIndex(itemIndex);
                    },
                  }}
                />
              </div>
            ) : leftItem && rightItem ? (
              <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
                <Player section={section} item={leftItem} other={rightItem} side="left" sync={sync} groupItems={group.items} />
                <Player section={section} item={rightItem} other={leftItem} side="right" sync={sync} groupItems={group.items} />
              </div>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" disabled={selectionBusy} onClick={() => trashChosen("keep")}>
                Keep selected
              </Button>
              <Button type="button" variant="secondary" disabled={selectionBusy} onClick={() => trashChosen("trash")}>
                Trash selected
              </Button>
            </div>
            <div className="flex justify-center gap-2 overflow-x-auto px-1 py-1">
              {group.items.map((item, itemIndex) => {
                const shown = imageOnly ? itemIndex === previewIndex : itemIndex === left || itemIndex === right;
                return (
                  <div
                    key={item.path}
                    className={cn(
                      "relative w-36 shrink-0 rounded-lg",
                      shown ? "ring-2 ring-primary ring-offset-2 ring-offset-popover" : "ring-1 ring-foreground/15",
                    )}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      draggable={imageOnly || undefined}
                      onClick={() => selectPreview(itemIndex)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        selectPreview(itemIndex);
                      }}
                      onDragStart={(event) => {
                        if (!imageOnly) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.setData(ITEM_DRAG_TYPE, String(itemIndex));
                        event.dataTransfer.setData("text/plain", String(itemIndex));
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      className={cn("block w-full overflow-hidden rounded-lg bg-black text-left", imageOnly && "cursor-grab active:cursor-grabbing")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt="" draggable={false} src={thumbSrc(section, item)} className="aspect-video w-full object-cover" />
                      <span className="block truncate px-1.5 py-1 text-[11px] text-white">
                        {itemIndex + 1}. {item.name}
                      </span>
                    </div>
                    {item.isPrimary ? (
                      <span className="pointer-events-none absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full bg-primary shadow-sm" aria-hidden>
                        <Star className="size-3 fill-white text-white" />
                      </span>
                    ) : null}
                    <input
                      type="checkbox"
                      checked={selected.has(item.path)}
                      onChange={() => toggleSelected(item.path)}
                      aria-label={`Select ${item.name}`}
                      className="absolute top-1.5 right-1.5 size-4 accent-primary"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Player({
  section,
  item,
  other,
  side,
  sync,
  soloImage = false,
  itemNumber,
  groupItems,
  imageCompare,
}: {
  section: SectionId;
  item: ClientItem;
  other: ClientItem;
  side: Side;
  sync: PlaybackPair;
  soloImage?: boolean;
  itemNumber?: number;
  groupItems?: ClientItem[];
  imageCompare?: ImageCompare;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playId = useRef(crypto.randomUUID());
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const base = useRef(0);
  const reportedFileTime = useRef<number | null>(null);
  const seekToken = useRef(0);
  const apiRef = useRef<SideApi | null>(null);

  useEffect(() => sync.register(side, apiRef), [side, sync]);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    void api<MediaInfo>(`/api/media/info?section=${section}&path=${encodeURIComponent(item.path)}`)
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch(() => {
        if (!cancelled) setInfo({ mode: "transcode", duration: item.durationSeconds, width: item.width, height: item.height, videoCodec: null, audioCodec: null });
      });
    return () => {
      cancelled = true;
    };
  }, [item.path, item.durationSeconds, item.width, item.height, section]);

  const playback = info?.mode ?? (likelyDirectPlayback(item.path, item.format) ? "direct" : null);

  useEffect(() => {
    const node = videoRef.current;
    if (!node || item.isImage) return;
    if (!playback) {
      if (node.getAttribute("src")) {
        node.removeAttribute("src");
        node.load();
      }
      return;
    }
    const start = item.partialClipOffsetSeconds > 0 ? 0 : other.partialClipOffsetSeconds;
    const direct = playback === "direct";
    base.current = direct ? 0 : start;
    const next = mediaSrc(section, item.path, direct ? null : start, playback, playId.current);
    const current = node.getAttribute("src") ?? "";
    if (current === next || (next.startsWith("/") && current.endsWith(next))) return;
    reportedFileTime.current = null;
    node.src = next;
  }, [playback, item, other.partialClipOffsetSeconds, section]);

  useEffect(() => {
    const node = videoRef.current;
    return () => {
      if (node) stopVideo(node);
    };
  }, [item.path]);

  function fileTime(): number {
    if (reportedFileTime.current !== null) return reportedFileTime.current;
    const node = videoRef.current;
    if (!node || !info) return 0;
    return info.mode === "direct" ? node.currentTime : base.current + node.currentTime;
  }

  function seekFile(seconds: number, origin: "user" | "sync") {
    const node = videoRef.current;
    if (!node || !info || item.isImage) return;
    const time = Math.max(0, seconds);
    if (origin === "sync" && Math.abs(fileTime() - time) < 0.2) return;
    const wasPlaying = !node.paused;

    if (info.mode === "direct") {
      sync.arm(side, "seek");
      node.currentTime = time;
    } else {
      const token = ++seekToken.current;
      sync.arm(side, "seek");
      if (wasPlaying) sync.arm(side, "pause");
      reportedFileTime.current = time;
      base.current = time;
      node.src = mediaSrc(section, item.path, time, info.mode, playId.current);
      node.dataset.seekToken = String(token);
      if (wasPlaying) {
        sync.arm(side, "play");
        void node.play().catch(() => undefined);
      }
    }

    if (origin === "user") sync.alignOther(side, toLong(item, time), wasPlaying);
  }

  apiRef.current = {
    ready: () => Boolean(videoRef.current && info && !item.isImage),
    getLongTime: () => toLong(item, fileTime()),
    isPaused: () => videoRef.current?.paused ?? true,
    canJump: () => info?.mode === "direct",
    ended: () => Boolean(videoRef.current?.ended),
    play: () => {
      const node = videoRef.current;
      if (!node || node.ended) return;
      sync.arm(side, "play");
      void node.play().catch(() => sync.forget(side, "play"));
    },
    pause: () => {
      const node = videoRef.current;
      if (!node || node.paused) return;
      sync.arm(side, "pause");
      node.pause();
    },
    seekLong: (longTime: number) => {
      seekFile(fromLong(item, longTime), "sync");
    },
  };

  const duration = info?.duration || item.durationSeconds;
  const frames = sampleTimes(duration, STRIP_FRAMES);
  const compareStats = Boolean(groupItems && groupItems.length > 1);
  const pool = groupItems?.length ? groupItems : [item];
  const maxPixels = Math.max(...pool.map((entry) => entry.width * entry.height));
  const minBytes = Math.min(...pool.map((entry) => entry.sizeBytes));
  const maxBitrate = Math.max(...pool.map((entry) => entry.bitrateKbps));
  const maxBitDepth = Math.max(...pool.map((entry) => entry.bitDepth));
  const bestResolution = item.width * item.height >= maxPixels;
  const smallestFile = item.sizeBytes <= minBytes;
  const bestBitrate = item.bitrateKbps >= maxBitrate;
  const bestBitDepth = item.bitDepth >= maxBitDepth;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {soloImage && itemNumber !== undefined ? (
        <div className="flex shrink-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted font-heading text-lg font-semibold tabular-nums text-foreground">
            {itemNumber}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-heading text-lg">{item.name}</h3>
              {item.isPrimary ? <Badge>Best</Badge> : null}
              {!item.matched ? <Badge variant="destructive">Unmatched</Badge> : null}
              {item.flags.map((flag) => (
                <Badge key={flag} variant="secondary">{flag}</Badge>
              ))}
            </div>
            <p className="truncate text-xs text-muted-foreground" title={item.path}>{item.path}</p>
          </div>
        </div>
      ) : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <h3 className="truncate font-heading text-lg">{item.name}</h3>
          {item.isPrimary ? <Badge>Best</Badge> : null}
          {!item.matched ? <Badge variant="destructive">Unmatched</Badge> : null}
          {item.flags.map((flag) => (
            <Badge key={flag} variant="secondary">{flag}</Badge>
          ))}
        </div>
      )}
      <p className="shrink-0 text-xs text-muted-foreground">
        <span className="tabular-nums">{formatPercent(item.similarity)}</span>
        {" · "}
        <span className={cn(compareStats && statTone(bestResolution))}>{item.resolution || "unknown size"}</span>
        {item.isImage ? (
          <>
            {" · "}
            <span className={cn(compareStats && statTone(bestBitDepth))}>{item.bitDepth > 0 ? `${item.bitDepth}-bit` : "unknown depth"}</span>
            {" · "}
            <span className={cn(compareStats && statTone(smallestFile))}>{formatBytes(item.sizeBytes)}</span>
          </>
        ) : (
          <>
            {" · "}
            <span className={cn(compareStats && statTone(bestBitrate))}>{Math.round(item.bitrateKbps)} kbps</span>
            {" · "}
            {formatDuration(item.durationSeconds)}
            {" · "}
            <span className={cn(compareStats && statTone(smallestFile))}>{formatBytes(item.sizeBytes)}</span>
            {item.partialClipOffsetSeconds > 0 ? ` · clip @ ${formatDuration(item.partialClipOffsetSeconds)}` : ""}
          </>
        )}
      </p>
      <div className="relative min-h-0 flex-1">
      {item.isImage ? (
        soloImage && imageCompare ? (
          <ImageStage key={imageCompare.resetKey} src={compareImageSrc(section, item.path)} compare={imageCompare} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            src={thumbSrc(section, item)}
            className="absolute inset-0 size-full rounded-xl object-contain"
          />
        )
      ) : (
        <video
          key={item.path}
          ref={videoRef}
          data-side={side}
          controls
          playsInline
          preload="auto"
          onPlay={() => sync.onPlay(side)}
          onPause={() => sync.onPause(side)}
          onSeeked={() => sync.onSeek(side)}
          onTimeUpdate={() => sync.tick()}
          onLoadedData={() => {
            const node = videoRef.current;
            if (node?.dataset.seekToken === String(seekToken.current)) reportedFileTime.current = null;
          }}
          onPointerDown={() => sync.disarm(side)}
          onKeyDown={() => sync.disarm(side)}
          className="absolute inset-0 size-full rounded-xl bg-black object-contain"
        />
      )}
      </div>
      {section === "server" && !item.isImage ? (
        <div className="grid shrink-0 grid-cols-6 gap-1">
          {frames.map((time, index) => (
            <button key={time} type="button" onClick={() => seekFile(time, "user")} className="overflow-hidden rounded-md bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="" src={`/api/thumbs?section=server&path=${encodeURIComponent(item.path)}&kind=strip&index=${index}`} className="aspect-video w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
      {info && info.mode !== "direct" && !item.isImage ? (
        <p className="shrink-0 text-xs text-muted-foreground">This file is transcoded on demand. Filmstrip clicks restart it at that time.</p>
      ) : null}
    </div>
  );
}

function stopVideo(node: HTMLVideoElement) {
  node.pause();
  if (!node.getAttribute("src")) return;
  node.removeAttribute("src");
  node.load();
}

function mediaSrc(section: SectionId, filePath: string, start: number | null, mode: "direct" | "remux" | "transcode", playId: string): string {
  const base = `/api/media?section=${section}&path=${encodeURIComponent(filePath)}&mode=${mode}&play=${encodeURIComponent(playId)}`;
  return start === null ? base : `${base}&t=${start.toFixed(3)}`;
}

function thumbSrc(section: SectionId, item: ClientItem): string {
  if (section === "immich" && item.assetId) return `/api/immich-thumb?id=${encodeURIComponent(item.assetId)}`;
  return `/api/thumbs?section=server&path=${encodeURIComponent(item.path)}&kind=poster`;
}

function compareImageSrc(section: SectionId, filePath: string): string {
  return `/api/media?section=${section}&path=${encodeURIComponent(filePath)}`;
}

function BlendControls({ compare }: { compare: ImageCompare }) {
  if (!compare.referenceSrc || compare.referenceNumber === null) return null;
  return (
    <div className="absolute top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-border bg-popover/95 px-1.5 py-1 shadow-md">
      <span className="flex size-7 items-center justify-center rounded-md bg-muted font-heading text-sm font-semibold tabular-nums">
        {compare.referenceNumber}
      </span>
      <select
        aria-label="Blend method"
        value={compare.blend}
        onChange={(event) => compare.onBlend(event.target.value as BlendMode)}
        className="h-7 rounded-md border border-input bg-transparent px-2 text-xs text-foreground dark:bg-input/30"
      >
        {BLEND_MODES.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Exit blending" onClick={compare.onClearReference}>
        <XIcon />
      </Button>
    </div>
  );
}

function ImageStage({ src, compare }: { src: string; compare: ImageCompare }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ImageView>({ scale: 1, x: 0, y: 0 });
  const sizeRef = useRef<{ width: number; height: number } | null>(null);
  const placedRef = useRef(false);
  const dragRef = useRef<{ id: number; sx: number; sy: number; x: number; y: number } | null>(null);
  const [view, setView] = useState<ImageView>({ scale: 1, x: 0, y: 0 });
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [placed, setPlaced] = useState(false);
  const [panning, setPanning] = useState(false);
  const [over, setOver] = useState(false);

  function bounds(): ImageBounds | null {
    const image = sizeRef.current;
    const node = viewportRef.current;
    if (!image || !node) return null;
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    return {
      viewportWidth: rect.width,
      viewportHeight: rect.height,
      imageWidth: image.width,
      imageHeight: image.height,
    };
  }

  function commit(next: ImageView) {
    const box = bounds();
    const clamped = box ? clampImageView(next, box) : next;
    viewRef.current = clamped;
    setView(clamped);
  }

  function placeIfNeeded() {
    if (placedRef.current) return;
    const image = sizeRef.current;
    const node = viewportRef.current;
    if (!image || !node) return;
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    commit(fitImage(rect.width, rect.height, image.width, image.height));
    placedRef.current = true;
    setPlaced(true);
  }

  function fit() {
    const image = sizeRef.current;
    const node = viewportRef.current;
    if (!image || !node) return;
    const rect = node.getBoundingClientRect();
    commit(fitImage(rect.width, rect.height, image.width, image.height));
    placedRef.current = true;
    setPlaced(true);
  }

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => placeIfNeeded());
    observer.observe(node);
    function onWheel(event: WheelEvent) {
      const viewport = viewportRef.current;
      if (!viewport) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const image = sizeRef.current;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const box = image
        ? { viewportWidth: rect.width, viewportHeight: rect.height, imageWidth: image.width, imageHeight: image.height }
        : undefined;
      commit(zoomImage(viewRef.current, event.clientX - rect.left, event.clientY - rect.top, factor, box));
      placedRef.current = true;
    }
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      node.removeEventListener("wheel", onWheel);
    };
  }, []);

  useEffect(() => {
    if (!placed || !size) return;
    const box = bounds();
    if (!box) return;
    const clamped = clampImageView(viewRef.current, box);
    if (clamped.x === viewRef.current.x && clamped.y === viewRef.current.y && clamped.scale === viewRef.current.scale) return;
    commit(clamped);
  }, [placed, size]);

  function onLoad(event: SyntheticEvent<HTMLImageElement>) {
    const next = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
    sizeRef.current = next;
    setSize(next);
    placeIfNeeded();
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: event.pointerId,
      sx: event.clientX,
      sy: event.clientY,
      x: viewRef.current.x,
      y: viewRef.current.y,
    };
    setPanning(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    commit({
      scale: viewRef.current.scale,
      x: drag.x + (event.clientX - drag.sx),
      y: drag.y + (event.clientY - drag.sy),
    });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.id !== event.pointerId) return;
    dragRef.current = null;
    setPanning(false);
  }

  function readDropIndex(event: DragEvent): number | null {
    const raw = event.dataTransfer.getData(ITEM_DRAG_TYPE) || event.dataTransfer.getData("text/plain");
    const index = Number(raw);
    return Number.isInteger(index) && index >= 0 ? index : null;
  }

  return (
    <div
      className={cn("absolute inset-0 overflow-hidden rounded-xl bg-black", over && "ring-2 ring-primary ring-inset")}
      onDragEnter={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const index = readDropIndex(event);
        if (index !== null) compare.onDropIndex(index);
      }}
    >
      <div
        ref={viewportRef}
        className={cn("absolute inset-0 touch-none", panning ? "cursor-grabbing" : "cursor-grab")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={fit}
      >
        <div
          className="absolute top-0 left-0"
          style={{
            width: size?.width ?? 0,
            height: size?.height ?? 0,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: "0 0",
            background: "#000",
            isolation: "isolate",
            opacity: placed ? 1 : 0,
          }}
        >
          {compare.referenceSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              src={compare.referenceSrc}
              draggable={false}
              className="pointer-events-none absolute top-0 left-0 max-w-none select-none"
            />
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            src={src}
            draggable={false}
            onLoad={onLoad}
            className="pointer-events-none absolute top-0 left-0 max-w-none select-none"
            style={{ mixBlendMode: compare.referenceSrc ? compare.blend : "normal" }}
          />
        </div>
      </div>
      <Button type="button" variant="secondary" size="xs" className="absolute top-2 right-2 z-10" onClick={fit}>
        Fit
      </Button>
      <BlendControls compare={compare} />
    </div>
  );
}

function statTone(best: boolean): string {
  return best ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
}

function previewIndexFromDigit(items: ClientItem[], key: string): number | null {
  if (key === "0") {
    const best = pickPrimaryIndex(items);
    return best >= 0 ? best : null;
  }
  const slot = Number(key) - 1;
  if (slot < 0 || slot >= items.length) return null;
  return slot;
}

function toLong(item: ClientItem, fileTime: number): number {
  return fileTime + item.partialClipOffsetSeconds;
}

function fromLong(item: ClientItem, longTime: number): number {
  return Math.max(0, longTime - item.partialClipOffsetSeconds);
}

type Side = "left" | "right";
type ArmKind = "play" | "pause" | "seek";

type SideApi = {
  ready: () => boolean;
  getLongTime: () => number;
  isPaused: () => boolean;
  canJump: () => boolean;
  ended: () => boolean;
  play: () => void;
  pause: () => void;
  seekLong: (longTime: number) => void;
};

type PlaybackPair = {
  register: (side: Side, api: RefObject<SideApi | null>) => () => void;
  reset: () => void;
  arm: (side: Side, kind: ArmKind) => void;
  forget: (side: Side, kind: ArmKind) => void;
  disarm: (side: Side) => void;
  alignOther: (side: Side, longTime: number, playing: boolean) => void;
  onPlay: (side: Side) => void;
  onPause: (side: Side) => void;
  onSeek: (side: Side) => void;
  tick: () => void;
};

function usePlaybackPair(): PlaybackPair {
  const apis = useRef<Partial<Record<Side, RefObject<SideApi | null>>>>({});
  const leader = useRef<Side | null>(null);
  const userPaused = useRef(false);
  const armed = useRef<Record<Side, Set<ArmKind>>>({ left: new Set(), right: new Set() });
  const lastJump = useRef(0);
  const raf = useRef(0);
  const pair = useRef<PlaybackPair | null>(null);

  if (!pair.current) {
    const get = (side: Side) => apis.current[side]?.current ?? null;
    const other = (side: Side): Side => (side === "left" ? "right" : "left");

    pair.current = {
      register(side, api) {
        apis.current[side] = api;
        return () => {
          if (apis.current[side] === api) delete apis.current[side];
        };
      },
      reset() {
        leader.current = null;
        userPaused.current = false;
        armed.current.left.clear();
        armed.current.right.clear();
        stopLoop();
      },
      arm(side, kind) {
        armed.current[side].add(kind);
      },
      forget(side, kind) {
        armed.current[side].delete(kind);
      },
      disarm(side) {
        armed.current[side].clear();
      },
      alignOther(side, longTime, playing) {
        leader.current = side;
        const pairApi = get(other(side));
        if (!pairApi?.ready()) return;
        if (Math.abs(pairApi.getLongTime() - longTime) > 0.25) pairApi.seekLong(longTime);
        if (playing && pairApi.isPaused()) pairApi.play();
        if (playing) startLoop();
      },
      onPlay(side) {
        if (consume(armed.current, side, "play")) {
          if (userPaused.current) get(side)?.pause();
          return;
        }
        const mine = get(side);
        const pairApi = get(other(side));
        if (!mine?.ready()) return;
        leader.current = side;
        userPaused.current = false;
        startLoop();
        if (!pairApi?.ready()) return;
        const time = mine.getLongTime();
        if (Math.abs(pairApi.getLongTime() - time) > 0.25) pairApi.seekLong(time);
        if (pairApi.isPaused()) pairApi.play();
      },
      onPause(side) {
        if (consume(armed.current, side, "pause")) return;
        if (get(side)?.ended()) return;
        userPaused.current = true;
        stopLoop();
        const pairApi = get(other(side));
        if (pairApi && !pairApi.isPaused()) pairApi.pause();
      },
      onSeek(side) {
        if (consume(armed.current, side, "seek")) return;
        const mine = get(side);
        const pairApi = get(other(side));
        if (!mine?.ready() || !pairApi?.ready()) return;
        leader.current = side;
        const time = mine.getLongTime();
        const playing = !mine.isPaused();
        if (Math.abs(pairApi.getLongTime() - time) > 0.25) pairApi.seekLong(time);
        if (playing && pairApi.isPaused()) pairApi.play();
        if (playing) startLoop();
      },
      tick() {
        const side = leader.current;
        if (!side || userPaused.current) return;
        const lead = get(side);
        const follow = get(other(side));
        if (!lead?.ready() || !follow?.ready() || lead.ended() || follow.ended()) return;
        const drift = follow.getLongTime() - lead.getLongTime();
        const action = driftAction(drift, lead.canJump() && follow.canJump(), false);
        if (action === "jump") {
          const now = performance.now();
          if (now - lastJump.current < 500) return;
          lastJump.current = now;
          follow.seekLong(lead.getLongTime());
          if (follow.isPaused()) follow.play();
          if (lead.isPaused()) lead.play();
        } else if (action === "hold-follower") {
          if (!follow.isPaused()) follow.pause();
          if (lead.isPaused()) lead.play();
        } else if (action === "hold-leader") {
          if (!lead.isPaused()) lead.pause();
          if (follow.isPaused()) follow.play();
        } else if (action === "resume") {
          if (follow.isPaused()) follow.play();
          if (lead.isPaused()) lead.play();
        }
      },
    };

    function startLoop() {
      if (raf.current) return;
      const step = () => {
        pair.current?.tick();
        if (userPaused.current) {
          raf.current = 0;
          return;
        }
        raf.current = window.requestAnimationFrame(step);
      };
      raf.current = window.requestAnimationFrame(step);
    }

    function stopLoop() {
      window.cancelAnimationFrame(raf.current);
      raf.current = 0;
    }
  }

  return pair.current;
}

function consume(armed: Record<Side, Set<ArmKind>>, side: Side, kind: ArmKind): boolean {
  if (!armed[side].has(kind)) return false;
  armed[side].delete(kind);
  return true;
}
