"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type RefObject, type SyntheticEvent } from "react";
import { AlbumTagsSkeleton, ThumbnailSkeleton } from "@/components/skeletons";
import { cn } from "cn";
import { api } from "@/components/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { STRIP_FRAMES, TRANSCODE_FULL_HEIGHT, TRANSCODE_START_HEIGHT, sampleTimes } from "@/lib/ffmpeg-args";
import { formatBytes, formatDuration, formatMediaDate, formatPercent } from "@/lib/format";
import { clampImageView, fitImage, zoomImage, type ImageBounds, type ImageView } from "@/lib/image-view";
import { driftAction } from "@/lib/playback-sync";
import { likelyDirectPlayback } from "@/lib/playback";
import type { ImmichAlbum } from "@/lib/immich";
import {
  albumName,
  albumSetsMismatch,
  groupAssetIds,
  missingAlbumIds,
  removableAlbumIds,
  type GroupAlbumMap,
} from "@/lib/immich-album-sync";
import { pickPrimaryIndex, pickSmallestIndex } from "@/lib/primary";
import type { ClientGroup, ClientItem, MediaInfo, SectionId } from "@/lib/types";
import { ChevronLeft, ChevronRight, Loader2, Pause, Play, Star, Volume2, VolumeX, XIcon } from "lucide-react";

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
  onActionDone,
  ignoredKey = null,
}: {
  section: SectionId;
  group: ClientGroup | null;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  /** Refresh data after an action; advance moves to the next group when the current one is gone. */
  onActionDone: (advance: boolean) => void | Promise<void>;
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
  const [bestPath, setBestPath] = useState<string | null>(null);
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
    setBestPath(null);
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
  const immichAlbumSync = useImmichGroupAlbums(section, group);
  const leftItem = group?.items[left] ?? null;
  const rightItem = group?.items[right] ?? null;
  const previewItem = group?.items[previewIndex] ?? null;

  useEffect(() => {
    sync.reset();
  }, [group, sync]);

  async function act(label: string, url: string, body: unknown, advance: boolean, method: "POST" | "DELETE" = "POST") {
    setPending(label);
    setError(null);
    try {
      await api(url, { method, body: JSON.stringify(body) });
      await onActionDone(advance);
      if (!advance) setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending(null);
    }
  }

  function stackPrimary(item: ClientItem | undefined) {
    if (!group || !item) return;
    if (!item.assetId) {
      setError("That file is not a matched Immich asset");
      return;
    }
    void act("Stack", "/api/immich/stack", { groupId: group.groupId, primaryId: item.assetId }, true);
  }

  function stackChosen() {
    if (!group) return;
    const chosen = group.items.filter((item) => selected.has(item.path));
    if (chosen.length < 2) {
      setError("Select at least two files to stack");
      return;
    }
    if (chosen.some((item) => !item.assetId)) {
      setError("A selected file is not a matched Immich asset");
      return;
    }
    const preferred = chosen.find((item) => item.path === bestPath);
    const primary = preferred ?? chosen[pickPrimaryIndex(chosen)];
    stackPrimary(primary);
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

  function selectAll() {
    if (!group) return;
    setSelected(new Set(group.items.map((item) => item.path)));
  }

  function unselectAll() {
    setSelected(new Set());
  }

  function invertSelection() {
    if (!group) return;
    setSelected((current) => {
      const next = new Set<string>();
      for (const item of group.items) {
        if (!current.has(item.path)) next.add(item.path);
      }
      return next;
    });
  }

  const selectionBusy = Boolean(pending) || selected.size === 0 || (group !== null && selected.size === group.items.length);
  const immich = section === "immich";
  const immichStackable = Boolean(group && group.items.filter((item) => item.assetId).length >= 2);
  const stackSelectionBusy = Boolean(pending) || !immichStackable || selected.size < 2;
  const rankedBest = group ? group.items[pickPrimaryIndex(group.items)] : undefined;
  const bestItem = (bestPath && group?.items.find((item) => item.path === bestPath)) || rankedBest;
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
            {immich ? (
              <>
                <Button type="button" size="sm" disabled={Boolean(pending) || !immichStackable || !bestItem?.assetId} onClick={() => stackPrimary(bestItem)}>
                  Stack all
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={Boolean(pending) || !bestItem?.assetId} onClick={() => keepOne(bestItem)}>
                  Keep best, trash rest
                </Button>
              </>
            ) : (
              <>
                <Button type="button" size="sm" disabled={Boolean(pending)} onClick={() => keepOne(bestItem)}>
                  Keep best
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={Boolean(pending)} onClick={() => keepOne(smallestItem)}>
                  Keep smallest
                </Button>
              </>
            )}
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
                  item={{ ...previewItem, isPrimary: previewItem.path === bestItem?.path }}
                  other={{ ...previewItem, isPrimary: previewItem.path === bestItem?.path }}
                  side="left"
                  sync={sync}
                  soloImage
                  itemNumber={previewIndex + 1}
                  groupItems={group.items}
                  immichAlbumSync={immichAlbumSync}
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
                <Player section={section} item={{ ...leftItem, isPrimary: leftItem.path === bestItem?.path }} other={{ ...rightItem, isPrimary: rightItem.path === bestItem?.path }} side="left" sync={sync} groupItems={group.items} itemNumber={left + 1} immichAlbumSync={immichAlbumSync} />
                <Player section={section} item={{ ...rightItem, isPrimary: rightItem.path === bestItem?.path }} other={{ ...leftItem, isPrimary: leftItem.path === bestItem?.path }} side="right" sync={sync} groupItems={group.items} itemNumber={right + 1} immichAlbumSync={immichAlbumSync} />
              </div>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="relative flex min-h-8 flex-wrap items-center gap-2">
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="pointer-events-auto flex flex-wrap justify-center gap-2">
                  {immich ? (
                    <Button type="button" disabled={stackSelectionBusy} onClick={stackChosen}>
                      Stack selected
                    </Button>
                  ) : (
                    <Button type="button" disabled={selectionBusy} onClick={() => trashChosen("keep")}>
                      Keep selected
                    </Button>
                  )}
                  <Button type="button" variant="secondary" disabled={selectionBusy} onClick={() => trashChosen("trash")}>
                    Trash selected
                  </Button>
                </div>
              </div>
              <div className="relative z-10 ml-auto flex flex-wrap items-center justify-end gap-3 text-xs">
                <button type="button" onClick={selectAll} className="text-muted-foreground hover:text-foreground">
                  Select all
                </button>
                <button type="button" onClick={unselectAll} className="text-muted-foreground hover:text-foreground">
                  Unselect all
                </button>
                <button type="button" onClick={invertSelection} className="text-muted-foreground hover:text-foreground">
                  Invert selection
                </button>
              </div>
            </div>
            <div className="flex justify-center gap-2 overflow-x-auto px-1 py-1">
              {group.items.map((item, itemIndex) => {
                const shown = imageOnly ? itemIndex === previewIndex : itemIndex === left || itemIndex === right;
                return (
                  <div
                    key={item.path}
                    className={cn(
                      "group relative w-36 shrink-0 rounded-lg",
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
                      <LoadingImage src={thumbSrc(section, item)} className="aspect-video w-full object-cover" />
                      <span className="block truncate px-1.5 py-1 text-[11px] text-white">
                        {itemIndex + 1}. {item.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={item.path === bestItem?.path ? `${item.name} is best` : `Mark ${item.name} as best`}
                      aria-pressed={item.path === bestItem?.path}
                      onClick={(event) => {
                        event.stopPropagation();
                        setBestPath(item.path);
                      }}
                      className={cn(
                        "absolute top-1.5 left-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-primary shadow-sm transition-opacity",
                        item.path === bestItem?.path
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-50 hover:opacity-100 focus-visible:opacity-100",
                      )}
                    >
                      <Star className="size-3 fill-white text-white" />
                    </button>
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
  immichAlbumSync,
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
  immichAlbumSync?: ImmichGroupAlbumSync;
  imageCompare?: ImageCompare;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lowRef = useRef<HTMLVideoElement>(null);
  const highRef = useRef<HTMLVideoElement>(null);
  const playId = useRef(crypto.randomUUID());
  const hqPlayId = useRef(`${playId.current.replace(/-/g, "").slice(0, 32)}hq`);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [clock, setClock] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  const base = useRef(0);
  const reportedFileTime = useRef<number | null>(null);
  const seekToken = useRef(0);
  const apiRef = useRef<SideApi | null>(null);
  const transcodeSpinnerRef = useRef<HTMLDivElement>(null);
  const qualityRef = useRef(TRANSCODE_START_HEIGHT);
  const loopStart = useRef(0);
  const upgrading = useRef(false);
  const upgradeAnchor = useRef(0);
  const upgradeFrame = useRef(0);
  const upgradeOpenedAt = useRef(0);
  const upgradeLead = useRef(2.5);
  const upgradeRestarts = useRef(0);
  const [sharp, setSharp] = useState(false);

  useEffect(() => sync.register(side, apiRef), [side, sync]);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setClock(0);
    setScrub(null);
    setPaused(true);
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
    qualityRef.current = TRANSCODE_START_HEIGHT;
    upgrading.current = false;
    setSharp(false);
  }, [item.path]);

  useEffect(() => {
    const node = lowRef.current;
    if (!node || item.isImage) return;
    videoRef.current = node;
    upgrading.current = false;
    if (highRef.current?.getAttribute("src")) stopVideo(highRef.current);
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
    loopStart.current = direct ? 0 : start;
    const next = mediaSrc(section, item.path, direct ? null : start, playback, playId.current, playback === "transcode" ? qualityRef.current : undefined);
    const current = node.getAttribute("src") ?? "";
    if (current === next || (next.startsWith("/") && current.endsWith(next))) return;
    reportedFileTime.current = null;
    node.loop = true;
    setTranscodeSpinner(transcodeSpinnerRef.current, !direct);
    node.src = next;
  }, [playback, item.path, item.partialClipOffsetSeconds, other.partialClipOffsetSeconds, section]);

  useEffect(() => {
    const low = lowRef.current;
    const high = highRef.current;
    return () => {
      cancelAnimationFrame(upgradeFrame.current);
      if (low) stopVideo(low);
      if (high) stopVideo(high);
    };
  }, [item.path]);

  function fileTime(): number {
    if (reportedFileTime.current !== null) return reportedFileTime.current;
    const node = videoRef.current;
    if (!node || !info) return 0;
    return info.mode === "direct" ? node.currentTime : base.current + node.currentTime;
  }

  function openTranscode(node: HTMLVideoElement, fileSeconds: number, height: number, wasPlaying: boolean) {
    const token = ++seekToken.current;
    sync.arm(side, "seek");
    if (wasPlaying) sync.arm(side, "pause");
    reportedFileTime.current = fileSeconds;
    base.current = fileSeconds;
    qualityRef.current = height;
    node.loop = Math.abs(fileSeconds - loopStart.current) < 0.05;
    setTranscodeSpinner(transcodeSpinnerRef.current, true);
    node.src = mediaSrc(section, item.path, fileSeconds, "transcode", playId.current, height);
    node.dataset.seekToken = String(token);
    if (wasPlaying) {
      sync.arm(side, "play");
      void node.play().catch(() => undefined);
    }
  }

  function watchUpgrade() {
    cancelAnimationFrame(upgradeFrame.current);
    const tick = () => {
      if (!upgrading.current) return;
      tryAdopt();
      if (!upgrading.current) return;
      upgradeFrame.current = requestAnimationFrame(tick);
    };
    upgradeFrame.current = requestAnimationFrame(tick);
  }

  function openHigh(anchor: number) {
    const low = lowRef.current;
    const high = highRef.current;
    if (!low || !high) return;
    upgradeAnchor.current = anchor;
    upgradeOpenedAt.current = performance.now();
    high.playbackRate = 1;
    high.loop = Math.abs(anchor - loopStart.current) < 0.05;
    high.src = mediaSrc(section, item.path, anchor, "transcode", hqPlayId.current, TRANSCODE_FULL_HEIGHT);
    if (!low.paused) void high.play().catch(() => undefined);
  }

  function startUpgrade() {
    const low = lowRef.current;
    const high = highRef.current;
    if (!low || !high || !info || info.mode !== "transcode") return;
    if (qualityRef.current >= TRANSCODE_FULL_HEIGHT || upgrading.current) return;
    upgrading.current = true;
    upgradeRestarts.current = 0;
    upgradeLead.current = 2.5;
    const duration = info.duration || item.durationSeconds;
    openHigh(Math.min(Math.max(0, duration - 0.3), fileTime() + upgradeLead.current));
    watchUpgrade();
  }

  function finishUpgrade() {
    const low = lowRef.current;
    const high = highRef.current;
    if (!low || !high || !upgrading.current) return;
    const playing = !low.paused && !low.ended;
    cancelAnimationFrame(upgradeFrame.current);
    high.playbackRate = 1;
    videoRef.current = high;
    base.current = upgradeAnchor.current;
    qualityRef.current = TRANSCODE_FULL_HEIGHT;
    upgrading.current = false;
    setClock(upgradeAnchor.current + high.currentTime);
    setSharp(true);
    stopVideo(low);
    if (playing && high.paused) {
      sync.arm(side, "play");
      void high.play().catch(() => undefined);
    } else if (!playing) {
      high.pause();
    }
  }

  function tryAdopt() {
    const low = lowRef.current;
    const high = highRef.current;
    if (!upgrading.current || !low || !high || !info || high.readyState < 2 || high.videoWidth < 1) return;
    const skew = fileTime() - (upgradeAnchor.current + high.currentTime);
    // 720p was opened ahead of the preview. Hold its first frame until playback arrives there.
    if (skew < -0.2) {
      high.playbackRate = 1;
      if (!high.paused) high.pause();
      return;
    }
    if (skew <= 0.35) {
      finishUpgrade();
      return;
    }
    // The preview is already past this 720p transcode. Open the next one further ahead,
    // using how long the last one took to produce a picture.
    if (upgradeRestarts.current >= 3) return;
    const elapsed = (performance.now() - upgradeOpenedAt.current) / 1000;
    upgradeRestarts.current += 1;
    upgradeLead.current = Math.min(12, Math.max(upgradeLead.current, elapsed + 0.8));
    const duration = info.duration || item.durationSeconds;
    const now = fileTime();
    if (now + 0.5 >= duration) return;
    openHigh(Math.min(duration - 0.3, now + upgradeLead.current));
  }

  function seekFile(seconds: number, origin: "user" | "sync" | "loop") {
    const node = videoRef.current;
    if (!node || !info || item.isImage) return;
    const time = Math.max(0, Math.min(seconds, item.durationSeconds || seconds));
    setClock(time);
    setScrub(null);
    if (origin === "sync" && Math.abs(fileTime() - time) < 0.2) return;
    const wasPlaying = origin === "loop" || !node.paused;

    if (info.mode === "direct" || canSeekBuffered(node, time - base.current)) {
      sync.arm(side, "seek");
      node.currentTime = info.mode === "direct" ? time : Math.max(0, time - base.current);
      if (origin === "loop") {
        sync.arm(side, "play");
        void node.play().catch(() => undefined);
      }
    } else if (info.mode === "transcode") {
      let target = node;
      if (origin === "user") {
        qualityRef.current = TRANSCODE_START_HEIGHT;
        upgrading.current = false;
        cancelAnimationFrame(upgradeFrame.current);
        if (lowRef.current) {
          target = lowRef.current;
          videoRef.current = lowRef.current;
        }
        if (highRef.current?.getAttribute("src")) stopVideo(highRef.current);
        setSharp(false);
      }
      if (target) openTranscode(target, time, qualityRef.current, wasPlaying);
    } else {
      const token = ++seekToken.current;
      sync.arm(side, "seek");
      if (wasPlaying) sync.arm(side, "pause");
      reportedFileTime.current = time;
      base.current = time;
      setTranscodeSpinner(transcodeSpinnerRef.current, true);
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

  function isShown(event: SyntheticEvent<HTMLVideoElement>): boolean {
    return event.currentTarget === videoRef.current;
  }

  function onActivePlay(event: SyntheticEvent<HTMLVideoElement>) {
    if (!isShown(event)) return;
    setPaused(false);
    sync.onPlay(side);
  }

  function onActivePause(event: SyntheticEvent<HTMLVideoElement>) {
    if (!isShown(event)) return;
    setPaused(true);
    sync.onPause(side);
  }

  function onActiveSeeked(event: SyntheticEvent<HTMLVideoElement>) {
    if (!isShown(event)) return;
    sync.onSeek(side);
  }

  function onActiveTime(event: SyntheticEvent<HTMLVideoElement>) {
    if (!isShown(event)) return;
    setClock(fileTime());
    sync.tick();
    if (upgrading.current && event.currentTarget === lowRef.current) tryAdopt();
  }

  function onActiveEnded(event: SyntheticEvent<HTMLVideoElement>) {
    if (!isShown(event)) return;
    seekFile(loopStart.current, "loop");
  }

  function onActiveLoaded(event: SyntheticEvent<HTMLVideoElement>) {
    if (!isShown(event)) return;
    if (event.currentTarget.dataset.seekToken === String(seekToken.current)) reportedFileTime.current = null;
    setTranscodeSpinner(transcodeSpinnerRef.current, false);
    if (info?.mode === "transcode" && event.currentTarget === lowRef.current) startUpgrade();
  }

  function onActiveError(event: SyntheticEvent<HTMLVideoElement>) {
    if (!isShown(event)) return;
    setTranscodeSpinner(transcodeSpinnerRef.current, false);
  }

  const fileDuration = info?.duration || item.durationSeconds;
  const frames = sampleTimes(fileDuration, STRIP_FRAMES);
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
  const mediaDate = formatMediaDate(item.dateCreatedMs);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {itemNumber !== undefined ? (
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
            {section === "immich" && item.assetId && immichAlbumSync ? (
              <ImmichAlbumTags assetId={item.assetId} sync={immichAlbumSync} />
            ) : null}
            {soloImage ? <p className="truncate text-xs text-muted-foreground" title={item.path}>{item.path}</p> : null}
          </div>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <h3 className="truncate font-heading text-lg">{item.name}</h3>
            {item.isPrimary ? <Badge>Best</Badge> : null}
            {!item.matched ? <Badge variant="destructive">Unmatched</Badge> : null}
            {item.flags.map((flag) => (
              <Badge key={flag} variant="secondary">{flag}</Badge>
            ))}
          </div>
          {section === "immich" && item.assetId && immichAlbumSync ? (
            <ImmichAlbumTags assetId={item.assetId} sync={immichAlbumSync} />
          ) : null}
        </>
      )}
      <p className="flex shrink-0 items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
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
        </span>
        {mediaDate ? <span className="shrink-0 tabular-nums">{mediaDate}</span> : null}
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
        <>
        <video
          key={`${item.path}-low`}
          ref={lowRef}
          data-side={side}
          muted={muted}
          playsInline
          preload="auto"
          onPlay={onActivePlay}
          onPause={onActivePause}
          onSeeked={onActiveSeeked}
          onTimeUpdate={onActiveTime}
          onEnded={onActiveEnded}
          onLoadedData={onActiveLoaded}
          onError={onActiveError}
          onPointerDown={() => sync.disarm(side)}
          onKeyDown={() => sync.disarm(side)}
          className={cn(
            "absolute inset-0 size-full rounded-xl bg-black object-contain",
            sharp ? "z-0 pointer-events-none opacity-0" : "z-10",
          )}
        />
        <video
          key={`${item.path}-high`}
          ref={highRef}
          data-side={side}
          muted={!sharp || muted}
          playsInline
          preload="auto"
          onPlay={onActivePlay}
          onPause={onActivePause}
          onSeeked={onActiveSeeked}
          onTimeUpdate={(event) => {
            onActiveTime(event);
            if (event.currentTarget === highRef.current) tryAdopt();
          }}
          onProgress={(event) => {
            if (event.currentTarget === highRef.current) tryAdopt();
          }}
          onLoadedData={(event) => {
            onActiveLoaded(event);
            if (event.currentTarget === highRef.current) tryAdopt();
          }}
          onPointerDown={() => sync.disarm(side)}
          onKeyDown={() => sync.disarm(side)}
          className={cn(
            "absolute inset-0 size-full rounded-xl bg-black object-contain",
            sharp ? "z-10" : "z-0 pointer-events-none opacity-0",
          )}
        />
        </>
      )}
      {!item.isImage ? (
        <div
          ref={(node) => {
            transcodeSpinnerRef.current = node;
            if (!node || node.dataset.bound === "1") return;
            node.dataset.bound = "1";
            node.hidden = true;
          }}
          className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
        >
          <Loader2 className="size-8 animate-spin" aria-hidden />
          <span className="text-xs">Transcoding…</span>
        </div>
      ) : null}
      {!item.isImage ? (
        <StreamClock
          paused={paused}
          muted={muted}
          position={scrub ?? clock}
          duration={item.durationSeconds}
          onToggle={() => {
            const node = videoRef.current;
            if (!node) return;
            if (node.paused) void node.play().catch(() => undefined);
            else node.pause();
          }}
          onMute={() => setMuted((value) => !value)}
          onScrub={setScrub}
          onSeek={(seconds) => seekFile(seconds, "user")}
        />
      ) : null}
      </div>
      {!item.isImage ? (
        <div className="grid shrink-0 grid-cols-6 gap-1">
          {frames.map((time, index) => (
            <button key={time} type="button" onClick={() => seekFile(time, "user")} className="overflow-hidden rounded-md bg-black">
              <LoadingImage src={`/api/thumbs?section=${section}&path=${encodeURIComponent(item.path)}&kind=strip&index=${index}`} className="aspect-video w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LoadingImage({ src, className }: { src: string; className?: string }) {
  const [ready, setReady] = useState(false);
  return (
    <span className="relative block bg-black">
      {ready ? null : <ThumbnailSkeleton />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        draggable={false}
        src={src}
        onLoad={() => setReady(true)}
        onError={() => setReady(true)}
        className={cn(className, ready ? "opacity-100" : "opacity-0")}
      />
    </span>
  );
}

type ImmichGroupAlbumSync = {
  assetIds: string[];
  byAsset: GroupAlbumMap;
  loading: boolean;
  refresh: () => void;
};

function useImmichGroupAlbums(section: SectionId, group: ClientGroup | null): ImmichGroupAlbumSync {
  const [byAsset, setByAsset] = useState<GroupAlbumMap>({});
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const assetIds = useMemo(
    () => (section === "immich" && group ? groupAssetIds(group.items) : []),
    [section, group],
  );
  const assetKey = assetIds.join("\0");

  useEffect(() => {
    if (assetIds.length === 0) {
      setByAsset({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void Promise.all(
      assetIds.map(async (id) => {
        const body = await api<{ albums: ImmichAlbum[] }>(`/api/immich/albums?assetId=${encodeURIComponent(id)}`);
        return [id, body.albums] as const;
      }),
    )
      .then((pairs) => {
        if (!cancelled) setByAsset(Object.fromEntries(pairs));
      })
      .catch(() => {
        if (!cancelled) setByAsset({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assetKey, version]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  return useMemo(() => ({ assetIds, byAsset, loading, refresh }), [assetIds, byAsset, loading, refresh]);
}

function ImmichAlbumTags({ assetId, sync }: { assetId: string; sync: ImmichGroupAlbumSync }) {
  const [pendingRemove, setPendingRemove] = useState<{ albumId: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { assetIds, byAsset, loading, refresh } = sync;
  const own = byAsset[assetId] ?? [];
  const mismatch = !loading && albumSetsMismatch(assetIds, byAsset);
  const removable = mismatch ? removableAlbumIds(assetId, assetIds, byAsset) : [];
  const missing = mismatch ? missingAlbumIds(assetId, assetIds, byAsset) : [];
  const removableSet = new Set(removable);
  const shared = own.filter((album) => !removableSet.has(album.id));

  async function mutateAlbum(albumId: string, action: "add" | "remove") {
    setBusy(true);
    setActionError(null);
    try {
      await api("/api/immich/albums/assets", {
        method: "POST",
        body: JSON.stringify({ albumId, assetId, action }),
      });
      setPendingRemove(null);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Album update failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <AlbumTagsSkeleton />;

  if (!mismatch) {
    if (own.length === 0) return <p className="shrink-0 text-xs text-muted-foreground">Not in any album</p>;
    const label = own.map((album) => album.name).join(" · ");
    return (
      <p className="shrink-0 truncate text-xs text-muted-foreground" title={label}>
        {label}
      </p>
    );
  }

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {own.length === 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">Not in any album</span>
        ) : null}
        {shared.map((album) => (
          <Badge key={album.id} variant="secondary" className="max-w-full truncate font-normal">
            {album.name}
          </Badge>
        ))}
        {removable.map((albumId) => {
          const name = albumName(byAsset, albumId);
          return (
            <button
              key={`remove-${albumId}`}
              type="button"
              disabled={busy}
              title={`Remove from ${name}`}
              onClick={() => setPendingRemove({ albumId, name })}
              className="max-w-full"
            >
              <Badge variant="outline" className="cursor-pointer truncate font-normal hover:bg-destructive/10 hover:text-destructive">
                {name}
              </Badge>
            </button>
          );
        })}
        {missing.map((albumId) => {
          const name = albumName(byAsset, albumId);
          return (
            <button
              key={`add-${albumId}`}
              type="button"
              disabled={busy}
              title={`Add to ${name}`}
              onClick={() => void mutateAlbum(albumId, "add")}
              className="max-w-full"
            >
              <Badge variant="outline" className="cursor-pointer truncate border-dashed font-normal hover:bg-primary/10 hover:text-primary">
                + {name}
              </Badge>
            </button>
          );
        })}
      </div>
      {actionError ? <p className="text-xs text-destructive">{actionError}</p> : null}
      <Dialog open={pendingRemove !== null} onOpenChange={(open) => !open && !busy && setPendingRemove(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove from album?</DialogTitle>
            <DialogDescription>
              {pendingRemove
                ? `Remove this copy from “${pendingRemove.name}”? Other duplicates in the group are not changed.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setPendingRemove(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || !pendingRemove}
              onClick={() => pendingRemove && void mutateAlbum(pendingRemove.albumId, "remove")}
            >
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StreamClock({
  paused,
  muted,
  position,
  duration,
  onToggle,
  onMute,
  onScrub,
  onSeek,
}: {
  paused: boolean;
  muted: boolean;
  position: number;
  duration: number;
  onToggle: () => void;
  onMute: () => void;
  onScrub: (seconds: number | null) => void;
  onSeek: (seconds: number) => void;
}) {
  const length = Math.max(duration, 0.1);
  const shown = Math.min(Math.max(position, 0), duration || 0);
  return (
    <div className="absolute inset-x-2 bottom-2 z-10 flex items-center gap-2 rounded-lg bg-black/75 px-2 py-1 text-xs text-white">
      <button type="button" onClick={onToggle} aria-label={paused ? "Play" : "Pause"} className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-white/15">
        {paused ? <Play className="size-3.5 fill-current" /> : <Pause className="size-3.5 fill-current" />}
      </button>
      <button type="button" onClick={onMute} aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-white/15">
        {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
      </button>
      <input
        type="range"
        min={0}
        max={length}
        step={0.1}
        value={shown}
        aria-label="Playback position"
        className="min-w-0 flex-1 accent-primary"
        onInput={(event) => onScrub(Number(event.currentTarget.value))}
        onPointerUp={(event) => {
          onScrub(null);
          onSeek(Number(event.currentTarget.value));
        }}
        onKeyUp={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
          onScrub(null);
          onSeek(Number(event.currentTarget.value));
        }}
        onBlur={() => onScrub(null)}
      />
      <span className="shrink-0 tabular-nums">
        {formatPlayerClock(shown)} / {formatPlayerClock(duration)}
      </span>
    </div>
  );
}

function formatPlayerClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function setTranscodeSpinner(node: HTMLDivElement | null, visible: boolean) {
  if (!node) return;
  node.hidden = !visible;
}

function canSeekBuffered(node: HTMLVideoElement, seconds: number): boolean {
  if (!Number.isFinite(seconds) || seconds < 0) return false;
  const ranges = node.buffered;
  for (let index = 0; index < ranges.length; index += 1) {
    if (seconds >= ranges.start(index) - 0.05 && seconds <= ranges.end(index) - 0.1) return true;
  }
  return false;
}

function stopVideo(node: HTMLVideoElement) {
  node.playbackRate = 1;
  node.pause();
  if (!node.getAttribute("src")) return;
  node.removeAttribute("src");
  node.load();
}

function mediaSrc(
  section: SectionId,
  filePath: string,
  start: number | null,
  mode: "direct" | "remux" | "transcode",
  playId: string,
  height?: number,
): string {
  const base = `/api/media?section=${section}&path=${encodeURIComponent(filePath)}&mode=${mode}&play=${encodeURIComponent(playId)}`;
  const timed = start === null ? base : `${base}&t=${start.toFixed(3)}`;
  return mode === "transcode" && height ? `${timed}&h=${height}` : timed;
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
