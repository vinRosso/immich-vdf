import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import { runPool } from "../src/lib/concurrency";
import { clampScanParallelism, maxScanParallelism } from "../src/lib/config";
import { normalizeStoredSettings } from "../src/lib/store";

test("legacy thumbnail jobs merge into parallelism only when it is still 1", () => {
  const cores = os.cpus().length;
  const max = maxScanParallelism(cores);
  const merged = normalizeStoredSettings({
    server: { scan: { parallelism: 1 }, ffmpegConcurrency: 4 },
  });
  assert.equal(merged.server.scan.parallelism, Math.min(max, 4));
  const kept = normalizeStoredSettings({
    server: { scan: { parallelism: 2 }, ffmpegConcurrency: 4 },
  });
  assert.equal(kept.server.scan.parallelism, clampScanParallelism(2, cores));
});

test("stored parallelism above the machine ceiling is clamped", () => {
  const settings = normalizeStoredSettings({
    server: { scan: { parallelism: 99 } },
    immich: { scan: { parallelism: 99 } },
  });
  const max = maxScanParallelism(os.cpus().length);
  assert.equal(settings.server.scan.parallelism, max);
  assert.equal(settings.immich.scan.parallelism, max);
});

test("runPool keeps at most the requested workers in flight", async () => {
  let active = 0;
  let peak = 0;
  await runPool([1, 2, 3, 4, 5, 6], 2, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
  });
  assert.equal(peak, 2);
});
