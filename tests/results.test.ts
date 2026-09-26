import assert from "node:assert/strict";
import test from "node:test";
import { suggestFfmpegConcurrency } from "../src/lib/config";
import { attachAssets, cliPathToOriginal, matchAsset } from "../src/lib/immich-join";
import { playbackMode, type ProbeSummary } from "../src/lib/playback";
import { pickPrimaryIndex } from "../src/lib/primary";
import { dueSlot, nextOccurrence } from "../src/lib/schedule";
import type { ScheduleSettings, StoredGroup } from "../src/lib/types";

test("ffmpeg concurrency suggestion is half the cores, clamped to 1..4", () => {
  assert.equal(suggestFfmpegConcurrency(1), 1);
  assert.equal(suggestFfmpegConcurrency(2), 1);
  assert.equal(suggestFfmpegConcurrency(8), 4);
  assert.equal(suggestFfmpegConcurrency(16), 4);
});

test("primary prefers bitrate, then pixels, then size", () => {
  const index = pickPrimaryIndex([
    { bitrateKbps: 1000, width: 1920, height: 1080, sizeBytes: 10 },
    { bitrateKbps: 8000, width: 1280, height: 720, sizeBytes: 1 },
    { bitrateKbps: 8000, width: 1920, height: 1080, sizeBytes: 2 },
  ]);
  assert.equal(index, 2);
});

test("Immich originalPath joins through the longest mount prefix", () => {
  const maps = [
    { from: "/usr/src/app/upload", to: "/immich" },
    { from: "/external/photos", to: "/immich/external" },
  ];
  assert.equal(
    cliPathToOriginal("/immich/external/album/a.mp4", maps),
    "/external/photos/album/a.mp4",
  );
  assert.equal(cliPathToOriginal("/immich/library/ab/file.mp4", maps), "/usr/src/app/upload/library/ab/file.mp4");
  assert.equal(cliPathToOriginal("/other/file.mp4", maps), null);
  const asset = matchAsset("/usr/src/app/upload/library/ab/file.mp4", [
    { id: "asset-1", originalPath: "/usr/src/app/upload/library/ab/file.mp4" },
  ]);
  assert.equal(asset?.id, "asset-1");
  const groups: StoredGroup[] = [
    {
      groupId: "g",
      items: [
        {
          path: "/immich/library/ab/file.mp4",
          similarity: 99,
          sizeBytes: 1,
          durationSeconds: 1,
          resolution: "1x1",
          width: 1,
          height: 1,
          bitrateKbps: 1,
          flags: [],
          partialClipOffsetSeconds: 0,
          isImage: false,
          format: "h264",
          fps: 30,
          assetId: null,
          originalPath: null,
        },
      ],
    },
  ];
  const joined = attachAssets(groups, [{ id: "asset-1", originalPath: "/usr/src/app/upload/library/ab/file.mp4" }], maps);
  assert.equal(joined[0].items[0].assetId, "asset-1");
});

test("playback mode sends browser-safe mp4 and transcodes hevc", () => {
  const base: ProbeSummary = { formatNames: ["mov", "mp4"], videoCodec: "h264", audioCodec: "aac", duration: 1, width: 1, height: 1 };
  assert.equal(playbackMode(base), "direct");
  assert.equal(playbackMode({ ...base, formatNames: ["matroska", "webm"], videoCodec: "vp9", audioCodec: "opus" }), "direct");
  assert.equal(playbackMode({ ...base, formatNames: ["matroska"], videoCodec: "h264", audioCodec: "aac" }), "remux");
  assert.equal(playbackMode({ ...base, videoCodec: "hevc" }), "transcode");
});

test("daily schedule is due only inside the window and not twice", () => {
  const schedule: ScheduleSettings = { mode: "daily", time: "03:00", weekday: 0, timezone: "UTC" };
  const before = new Date("2026-09-26T02:00:00Z");
  const inside = new Date("2026-09-26T03:05:00Z");
  const late = new Date("2026-09-26T03:20:00Z");
  assert.equal(dueSlot(schedule, before, null), null);
  assert.equal(dueSlot(schedule, inside, null), "2026-09-26");
  assert.equal(dueSlot(schedule, inside, "2026-09-26"), null);
  assert.equal(dueSlot(schedule, late, null), null);
  assert.equal(nextOccurrence(schedule, before)?.toISOString(), "2026-09-26T03:00:00.000Z");
  assert.equal(nextOccurrence(schedule, late)?.toISOString(), "2026-09-27T03:00:00.000Z");
  const weekly: ScheduleSettings = { mode: "weekly", time: "03:00", weekday: 0, timezone: "UTC" };
  assert.equal(nextOccurrence(weekly, new Date("2026-09-26T12:00:00Z"))?.toISOString(), "2026-09-27T03:00:00.000Z");
});
