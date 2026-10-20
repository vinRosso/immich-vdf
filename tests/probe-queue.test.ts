import assert from "node:assert/strict";
import test from "node:test";
import { createCachedLoader, createLaneQueue } from "../src/lib/probe-queue";

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("the queue never runs more tasks than the limit", async () => {
  const queue = createLaneQueue(() => 2);
  const gates = [gate(), gate(), gate(), gate()];
  let running = 0;
  let peak = 0;
  const jobs = gates.map((g) =>
    queue.run("interactive", async () => {
      running += 1;
      peak = Math.max(peak, running);
      await g.opened;
      running -= 1;
    }),
  );
  await tick();
  assert.equal(queue.stats().active, 2);
  assert.equal(queue.stats().waiting, 2);
  for (const g of gates) g.open();
  await Promise.all(jobs.map((job) => job.promise));
  assert.equal(peak, 2);
});

test("interactive tasks start before queued background tasks", async () => {
  const queue = createLaneQueue(() => 1);
  const first = gate();
  const order: string[] = [];
  const blocker = queue.run("interactive", () => first.opened);
  const background = queue.run("background", async () => void order.push("background"));
  const interactive = queue.run("interactive", async () => void order.push("interactive"));
  await tick();
  first.open();
  await Promise.all([blocker.promise, background.promise, interactive.promise]);
  assert.deepEqual(order, ["interactive", "background"]);
});

test("background tasks keep one slot free for interactive work", async () => {
  const queue = createLaneQueue(() => 3);
  const gates = [gate(), gate(), gate()];
  let started = 0;
  const jobs = gates.map((g) =>
    queue.run("background", async () => {
      started += 1;
      await g.opened;
    }),
  );
  await tick();
  assert.equal(started, 2);
  let interactiveStarted = false;
  const interactive = queue.run("interactive", async () => void (interactiveStarted = true));
  await tick();
  assert.equal(interactiveStarted, true);
  for (const g of gates) g.open();
  await Promise.all([...jobs.map((job) => job.promise), interactive.promise]);
});

test("a promoted background task jumps ahead of other background tasks", async () => {
  const queue = createLaneQueue(() => 1);
  const first = gate();
  const order: string[] = [];
  const blocker = queue.run("interactive", () => first.opened);
  const early = queue.run("background", async () => void order.push("early"));
  const late = queue.run("background", async () => void order.push("late"));
  late.promote();
  first.open();
  await Promise.all([blocker.promise, early.promise, late.promise]);
  assert.deepEqual(order, ["late", "early"]);
});

test("a thrown task rejects its promise and frees its slot", async () => {
  const queue = createLaneQueue(() => 1);
  const failing = queue.run("interactive", () => {
    throw new Error("boom");
  });
  await assert.rejects(failing.promise, /boom/);
  const after = await queue.run("interactive", async () => "ok").promise;
  assert.equal(after, "ok");
});

test("concurrent gets for one key share one load", async () => {
  const queue = createLaneQueue(() => 2);
  let loads = 0;
  const g = gate();
  const loader = createCachedLoader({
    queue,
    maxEntries: 10,
    failureTtlMs: 1000,
    load: async (arg) => {
      loads += 1;
      await g.opened;
      return arg.toUpperCase();
    },
  });
  const a = loader.get("k", "a", "interactive");
  const b = loader.get("k", "a", "background");
  g.open();
  assert.deepEqual(await Promise.all([a, b]), ["A", "A"]);
  assert.equal(loads, 1);
  assert.equal(await loader.get("k", "a", "interactive"), "A");
  assert.equal(loads, 1);
});

test("an interactive get promotes a queued background load", async () => {
  const queue = createLaneQueue(() => 1);
  const g = gate();
  const order: string[] = [];
  const loader = createCachedLoader({
    queue,
    maxEntries: 10,
    failureTtlMs: 1000,
    load: async (arg) => {
      order.push(arg);
      return arg;
    },
  });
  const blocker = queue.run("interactive", () => g.opened);
  const other = loader.get("other", "other", "background");
  const wanted = loader.get("wanted", "wanted", "background");
  const promoted = loader.get("wanted", "wanted", "interactive");
  g.open();
  await Promise.all([blocker.promise, other, wanted, promoted]);
  assert.deepEqual(order, ["wanted", "other"]);
});

test("the cache drops the least recently used entry", async () => {
  const queue = createLaneQueue(() => 2);
  const loaded: string[] = [];
  const loader = createCachedLoader({
    queue,
    maxEntries: 2,
    failureTtlMs: 1000,
    load: async (arg) => {
      loaded.push(arg);
      return arg;
    },
  });
  await loader.get("a", "a", "interactive");
  await loader.get("b", "b", "interactive");
  await loader.get("a", "a", "interactive");
  await loader.get("c", "c", "interactive");
  assert.equal(loader.size(), 2);
  await loader.get("a", "a", "interactive");
  await loader.get("b", "b", "interactive");
  assert.deepEqual(loaded, ["a", "b", "c", "b"]);
});

test("a failure is remembered until its time is up, then retried", async () => {
  const queue = createLaneQueue(() => 1);
  let clock = 0;
  let loads = 0;
  const loader = createCachedLoader<string>({
    queue,
    maxEntries: 10,
    failureTtlMs: 1000,
    now: () => clock,
    load: async () => {
      loads += 1;
      if (loads === 1) throw new Error("ffprobe failed");
      return "fine";
    },
  });
  await assert.rejects(loader.get("k", "x", "interactive"), /ffprobe failed/);
  await assert.rejects(loader.get("k", "x", "interactive"), /ffprobe failed/);
  assert.equal(loads, 1);
  clock = 1001;
  assert.equal(await loader.get("k", "x", "interactive"), "fine");
  assert.equal(loads, 2);
});
