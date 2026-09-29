import assert from "node:assert/strict";
import test from "node:test";
import { enqueueFfmpeg, resetFfmpegPoolForTests } from "../src/lib/ffmpeg-pool";
import { cancelThumbWork, resetThumbSessionsForTests, thumbRequestSignal } from "../src/lib/thumb-sessions";

test("cancelThumbWork drops queued ffmpeg jobs for that path", async () => {
  resetFfmpegPoolForTests();
  resetThumbSessionsForTests();
  let releaseBlocker: (() => void) | undefined;
  const blocker = enqueueFfmpeg(
    1,
    () =>
      new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      }),
    { priority: "thumbnail" },
  );
  const file = "/media/example.mp4";
  const session = thumbRequestSignal(file);
  let started = false;
  const thumb = enqueueFfmpeg(
    1,
    async () => {
      started = true;
    },
    { priority: "thumbnail", signal: session.signal },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, false);
  cancelThumbWork([file]);
  releaseBlocker?.();
  await blocker;
  await thumb;
  assert.equal(started, false);
  session.release();
});

test("cancelThumbWork aborts an in-flight thumb job for that path", async () => {
  resetFfmpegPoolForTests();
  resetThumbSessionsForTests();
  const file = "/media/running.mp4";
  const session = thumbRequestSignal(file);
  let releaseJob: (() => void) | undefined;
  const job = enqueueFfmpeg(
    1,
    () =>
      new Promise<void>((resolve) => {
        releaseJob = resolve;
      }),
    { priority: "thumbnail", signal: session.signal },
  );
  await new Promise((resolve) => setImmediate(resolve));
  cancelThumbWork([file]);
  releaseJob?.();
  await job;
  assert.equal(session.signal.aborted, true);
  session.release();
});
