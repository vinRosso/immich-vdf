import assert from "node:assert/strict";
import test from "node:test";
import { enqueueFfmpeg, resetFfmpegPoolForTests } from "../src/lib/ffmpeg-pool";
import { claimPlayback } from "../src/lib/playback-sessions";

test("a new playback request cancels the previous one for that player", () => {
  const first = claimPlayback("11111111-1111-1111-1111-111111111111");
  const second = claimPlayback("11111111-1111-1111-1111-111111111111");
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  first.release();
  assert.equal(second.signal.aborted, false);
  second.release();
});

test("different players do not cancel each other", () => {
  const left = claimPlayback("22222222-2222-2222-2222-222222222222");
  const right = claimPlayback("33333333-3333-3333-3333-333333333333");
  assert.equal(left.signal.aborted, false);
  assert.equal(right.signal.aborted, false);
  left.release();
  right.release();
});

test("viewer thumbnails run before queued card posters", async () => {
  resetFfmpegPoolForTests();
  let release: (() => void) | undefined;
  const blocker = enqueueFfmpeg(
    1,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    { priority: "thumbnail" },
  );
  const order: string[] = [];
  const card = enqueueFfmpeg(
    1,
    async () => {
      order.push("card");
    },
    { priority: "thumbnail" },
  );
  const viewer = enqueueFfmpeg(
    1,
    async () => {
      order.push("viewer");
    },
    { priority: "viewer" },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, []);
  release?.();
  await blocker;
  await viewer;
  await card;
  assert.deepEqual(order, ["viewer", "card"]);
});

test("an aborted playback leaves the queue without starting", async () => {
  resetFfmpegPoolForTests();
  let releaseFirst: (() => void) | undefined;
  const first = enqueueFfmpeg(
    1,
    () =>
      new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
    { priority: "playback" },
  );
  const controller = new AbortController();
  let started = false;
  const second = enqueueFfmpeg(
    1,
    async () => {
      started = true;
    },
    { priority: "playback", signal: controller.signal },
  );
  controller.abort();
  await second;
  assert.equal(started, false);
  releaseFirst?.();
  await first;
});
