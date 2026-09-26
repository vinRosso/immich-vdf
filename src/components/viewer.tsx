"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/components/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { STRIP_FRAMES, sampleTimes } from "@/lib/ffmpeg-args";
import { formatBytes, formatDuration, formatPercent } from "@/lib/format";
import type { ClientGroup, ClientItem, MediaInfo, SectionId } from "@/lib/types";

export function Viewer({
  section,
  group,
  onClose,
  onChanged,
}: {
  section: SectionId;
  group: ClientGroup | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    setLeft(0);
    setRight(group && group.items.length > 1 ? 1 : 0);
    setError(null);
  }, [group]);

  const leftItem = group?.items[left] ?? null;
  const rightItem = group?.items[right] ?? null;

  async function act(label: string, url: string, body: unknown) {
    setPending(label);
    setError(null);
    try {
      await api(url, { method: "POST", body: JSON.stringify(body) });
      onChanged();
      if (label !== "Stack") onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog open={Boolean(group)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Compare</DialogTitle>
          <DialogDescription>
            Playback streams the mounted file. A partial-clip match starts the longer file at the clip offset.
          </DialogDescription>
        </DialogHeader>
        {group && leftItem && rightItem ? (
          <div className="space-y-4">
            {group.items.length > 2 ? (
              <div className="flex flex-wrap gap-2">
                {group.items.map((item, index) => (
                  <Button key={item.path} size="sm" variant={index === left || index === right ? "default" : "outline"} onClick={() => setRight(index)}>
                    {item.name}
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-2">
              <Player section={section} item={leftItem} other={rightItem} side="left" />
              <Player section={section} item={rightItem} other={leftItem} side="right" />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={Boolean(pending) || (section === "immich" && !leftItem.assetId)}
                onClick={() =>
                  void act(
                    "Trash",
                    section === "server" ? "/api/trash" : "/api/immich/trash",
                    section === "server"
                      ? { groupId: group.groupId, keepPath: leftItem.path }
                      : { groupId: group.groupId, keepId: leftItem.assetId },
                  )
                }
              >
                Keep left, trash the rest
              </Button>
              <Button
                variant="secondary"
                disabled={Boolean(pending) || (section === "immich" && !rightItem.assetId)}
                onClick={() =>
                  void act(
                    "Trash",
                    section === "server" ? "/api/trash" : "/api/immich/trash",
                    section === "server"
                      ? { groupId: group.groupId, keepPath: rightItem.path }
                      : { groupId: group.groupId, keepId: rightItem.assetId },
                  )
                }
              >
                Keep right, trash the rest
              </Button>
              {section === "immich" ? (
                <Button
                  variant="outline"
                  disabled={Boolean(pending) || !leftItem.assetId}
                  onClick={() => void act("Stack", "/api/immich/stack", { groupId: group.groupId, primaryId: leftItem.assetId })}
                >
                  Stack onto left
                </Button>
              ) : null}
              <Button variant="ghost" disabled={Boolean(pending)} onClick={() => void act("Ignore", "/api/ignore", { section, groupId: group.groupId })}>
                Ignore group
              </Button>
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
}: {
  section: SectionId;
  item: ClientItem;
  other: ClientItem;
  side: "left" | "right";
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const base = useRef(0);

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

  useEffect(() => {
    const node = videoRef.current;
    if (!node || !info || item.isImage) return;
    const start = item.partialClipOffsetSeconds > 0 ? 0 : other.partialClipOffsetSeconds;
    base.current = info.mode === "direct" ? 0 : start;
    node.src = mediaSrc(section, item.path, info.mode === "direct" ? null : start);
  }, [info, item, other.partialClipOffsetSeconds, section]);

  function fileTime(): number {
    const node = videoRef.current;
    if (!node || !info) return 0;
    return info.mode === "direct" ? node.currentTime : base.current + node.currentTime;
  }

  function seekFile(seconds: number) {
    const node = videoRef.current;
    if (!node || !info) return;
    const time = Math.max(0, seconds);
    if (info.mode === "direct") {
      node.currentTime = time;
      return;
    }
    base.current = time;
    const paused = node.paused;
    node.src = mediaSrc(section, item.path, time);
    if (!paused) void node.play().catch(() => undefined);
  }

  function onTime() {
    const mine = videoRef.current;
    const pair = document.querySelector<HTMLVideoElement>(`video[data-side="${side === "left" ? "right" : "left"}"]`);
    if (!mine || !pair || !info || mine.paused) return;
    const longTime = toLong(item, fileTime());
    const target = fromLong(other, longTime);
    if (Math.abs(pair.currentTime - target) > 0.45 && info.mode === "direct") pair.currentTime = target;
  }

  const duration = info?.duration || item.durationSeconds;
  const frames = sampleTimes(duration, STRIP_FRAMES);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-heading text-lg">{item.name}</h3>
        {item.isPrimary ? <Badge>Best</Badge> : null}
        {!item.matched ? <Badge variant="destructive">Unmatched</Badge> : null}
        {item.flags.map((flag) => (
          <Badge key={flag} variant="secondary">{flag}</Badge>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {formatPercent(item.similarity)} · {item.resolution || "unknown size"} · {Math.round(item.bitrateKbps)} kbps · {formatDuration(item.durationSeconds)} · {formatBytes(item.sizeBytes)}
        {item.partialClipOffsetSeconds > 0 ? ` · clip @ ${formatDuration(item.partialClipOffsetSeconds)}` : ""}
      </p>
      {item.isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" src={thumbSrc(section, item)} className="aspect-video w-full rounded-xl bg-black object-contain" />
      ) : (
        <video
          ref={videoRef}
          data-side={side}
          controls
          playsInline
          onTimeUpdate={onTime}
          onPlay={onTime}
          className="aspect-video w-full rounded-xl bg-black"
        />
      )}
      {section === "server" && !item.isImage ? (
        <div className="grid grid-cols-6 gap-1">
          {frames.map((time, index) => (
            <button key={time} type="button" onClick={() => seekFile(time)} className="overflow-hidden rounded-md bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="" src={`/api/thumbs?section=server&path=${encodeURIComponent(item.path)}&kind=strip&index=${index}`} className="aspect-video w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
      {info && info.mode !== "direct" && !item.isImage ? (
        <p className="text-xs text-muted-foreground">This file is transcoded on demand. Filmstrip clicks restart it at that time.</p>
      ) : null}
    </div>
  );
}

function mediaSrc(section: SectionId, filePath: string, start: number | null): string {
  const base = `/api/media?section=${section}&path=${encodeURIComponent(filePath)}`;
  return start === null ? base : `${base}&t=${start.toFixed(3)}`;
}

function thumbSrc(section: SectionId, item: ClientItem): string {
  if (section === "immich" && item.assetId) return `/api/immich-thumb?id=${encodeURIComponent(item.assetId)}`;
  return `/api/thumbs?section=server&path=${encodeURIComponent(item.path)}&kind=poster`;
}

function toLong(item: ClientItem, fileTime: number): number {
  return fileTime + item.partialClipOffsetSeconds;
}

function fromLong(item: ClientItem, longTime: number): number {
  return Math.max(0, longTime - item.partialClipOffsetSeconds);
}
