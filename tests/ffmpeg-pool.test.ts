import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import { maxScanParallelism } from "../src/lib/config";
import { enqueueFfmpeg, ffmpegSlots, resetFfmpegPoolForTests, type SetLane } from "../src/lib/ffmpeg-pool";
import { singleFlight } from "../src/lib/thumbs";

function blocker(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = enqueueFfmpeg(
    1,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    { priority: "thumbnail" },
  );
  return { promise, release: () => release() };
}

test("with no scan running the pool uses three quarters of the cores, whatever Parallel says", () => {
  const saved = process.env.VDF_FFMPEG_SLOTS;
  delete process.env.VDF_FFMPEG_SLOTS;
  try {
    resetFfmpegPoolForTests({ scanRunning: false });
    assert.equal(ffmpegSlots(1), maxScanParallelism(os.cpus().length));
    resetFfmpegPoolForTests({ scanRunning: true });
    assert.equal(ffmpegSlots(1), 1);
  } finally {
    if (saved === undefined) delete process.env.VDF_FFMPEG_SLOTS;
    else process.env.VDF_FFMPEG_SLOTS = saved;
  }
});

test("VDF_FFMPEG_SLOTS sets the pool size when no scan is running, at most the number of cores", () => {
  const saved = process.env.VDF_FFMPEG_SLOTS;
  process.env.VDF_FFMPEG_SLOTS = "1";
  try {
    resetFfmpegPoolForTests({ scanRunning: false });
    assert.equal(ffmpegSlots(1), 1);
    process.env.VDF_FFMPEG_SLOTS = "999";
    assert.equal(ffmpegSlots(1), os.cpus().length);
    process.env.VDF_FFMPEG_SLOTS = "nonsense";
    assert.equal(ffmpegSlots(1), maxScanParallelism(os.cpus().length));
  } finally {
    if (saved === undefined) delete process.env.VDF_FFMPEG_SLOTS;
    else process.env.VDF_FFMPEG_SLOTS = saved;
  }
});

test("prefetch for neighbouring groups waits behind posters", async () => {
  resetFfmpegPoolForTests();
  const first = blocker();
  const order: string[] = [];
  const prefetch = enqueueFfmpeg(1, async () => void order.push("prefetch"), { priority: "prefetch" });
  const poster = enqueueFfmpeg(1, async () => void order.push("poster"), { priority: "thumbnail" });
  await new Promise((resolve) => setImmediate(resolve));
  first.release();
  await Promise.all([first.promise, prefetch, poster]);
  assert.deepEqual(order, ["poster", "prefetch"]);
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a queued job moved to another lane runs in that lane, either way", async () => {
  resetFfmpegPoolForTests();
  const first = blocker();
  const order: string[] = [];
  let setLane: SetLane = () => undefined;
  const strip = enqueueFfmpeg(1, async () => void order.push("strip"), { priority: "strip" });
  const moved = enqueueFfmpeg(1, async () => void order.push("moved"), {
    priority: "prefetch",
    onQueued: (fn) => {
      setLane = fn;
    },
  });
  setLane("thumb");
  setLane("prefetch");
  await tick();
  first.release();
  await Promise.all([first.promise, strip, moved]);
  assert.deepEqual(order, ["strip", "moved"]);
});

test("a lane set from onQueued itself applies", async () => {
  resetFfmpegPoolForTests();
  const first = blocker();
  const order: string[] = [];
  const strip = enqueueFfmpeg(1, async () => void order.push("strip"), { priority: "strip" });
  const prefetch = enqueueFfmpeg(1, async () => void order.push("prefetch"), {
    priority: "prefetch",
    onQueued: (setLane) => setLane("thumb"),
  });
  await tick();
  first.release();
  await Promise.all([first.promise, strip, prefetch]);
  assert.deepEqual(order, ["prefetch", "strip"]);
});

test("thumb work started before a scan does not hold playback back once the cap drops", { skip: maxScanParallelism(os.cpus().length) < 2 }, async () => {
  const saved = process.env.VDF_FFMPEG_SLOTS;
  process.env.VDF_FFMPEG_SLOTS = "3";
  let scanning = false;
  resetFfmpegPoolForTests({ scanRunning: () => scanning });
  try {
    const releases: (() => void)[] = [];
    const thumbs = [0, 1].map(() =>
      enqueueFfmpeg(2, () => new Promise<void>((resolve) => void releases.push(resolve)), { priority: "thumbnail" }),
    );
    await tick();
    assert.equal(releases.length, 2);
    scanning = true;
    let played = false;
    const playback = enqueueFfmpeg(2, async () => void (played = true), { priority: "playback" });
    await tick();
    assert.equal(played, true);
    for (const release of releases) release();
    await Promise.all([...thumbs, playback]);
  } finally {
    if (saved === undefined) delete process.env.VDF_FFMPEG_SLOTS;
    else process.env.VDF_FFMPEG_SLOTS = saved;
  }
});

/** A flight whose encode goes through the pool, so its lane can be watched against a queued strip. */
function flightOrder(order: string[]) {
  return async (_signal: AbortSignal, onQueued: (setLane: SetLane) => void) => {
    await enqueueFfmpeg(1, async () => void order.push("flight"), { priority: "prefetch", onQueued });
    return "done";
  };
}

test("a viewer request joining a prefetch moves the shared encode ahead", async () => {
  resetFfmpegPoolForTests();
  const first = blocker();
  const order: string[] = [];
  const strip = enqueueFfmpeg(1, async () => void order.push("strip"), { priority: "strip" });
  const prefetch = singleFlight("join-test", flightOrder(order), undefined, "prefetch");
  const viewer = singleFlight("join-test", flightOrder(order), undefined, "thumb");
  await tick();
  first.release();
  await Promise.all([first.promise, strip, prefetch, viewer]);
  assert.deepEqual(order, ["flight", "strip"]);
});

test("the shared encode drops back when the urgent caller leaves", async () => {
  resetFfmpegPoolForTests();
  const first = blocker();
  const order: string[] = [];
  const strip = enqueueFfmpeg(1, async () => void order.push("strip"), { priority: "strip" });
  const prefetch = singleFlight("leave-test", flightOrder(order), undefined, "prefetch");
  const leaving = new AbortController();
  const viewer = singleFlight("leave-test", flightOrder(order), leaving.signal, "thumb");
  await tick();
  leaving.abort();
  await assert.rejects(viewer);
  first.release();
  await Promise.all([first.promise, strip, prefetch]);
  assert.deepEqual(order, ["strip", "flight"]);
});
