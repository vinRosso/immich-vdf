import assert from "node:assert/strict";
import test from "node:test";
import { buildVdfScanArgs } from "../src/lib/cli-args";
import { nativeFfmpegEnv, nativeFfmpegPlan, shouldRetryWithoutNative } from "../src/lib/native-ffmpeg";
import { defaultScan } from "../src/lib/scan-defaults";

const libs = [
  "libavcodec.so.62",
  "libavdevice.so.62",
  "libavfilter.so.11",
  "libavformat.so.62",
  "libavutil.so.60",
  "libswresample.so.6",
  "libswscale.so.9",
];

function folderWith(files: string[]) {
  return (file: string) => files.some((name) => file.replace(/\\/g, "/") === `/opt/ffmpeg/lib/${name}`);
}

test("native mode is off unless asked for or shipped", () => {
  assert.deepEqual(nativeFfmpegPlan({}, () => false), { enabled: false, libDir: null });
  assert.equal(nativeFfmpegPlan({ VDF_FFMPEG_LIBS: "/opt/ffmpeg/lib" }, folderWith([])).enabled, false);
});

test("the image's libraries turn it on only when every one is there", () => {
  const env = { VDF_FFMPEG_LIBS: "/opt/ffmpeg/lib" };
  assert.deepEqual(nativeFfmpegPlan(env, folderWith(libs)), { enabled: true, libDir: "/opt/ffmpeg/lib" });
  assert.equal(nativeFfmpegPlan(env, folderWith(libs.slice(1))).enabled, false);
});

test("VDF_NATIVE_FFMPEG overrides what was found", () => {
  const env = { VDF_FFMPEG_LIBS: "/opt/ffmpeg/lib" };
  assert.equal(nativeFfmpegPlan({ ...env, VDF_NATIVE_FFMPEG: "0" }, folderWith(libs)).enabled, false);
  assert.equal(nativeFfmpegPlan({ VDF_NATIVE_FFMPEG: "1" }, () => false).enabled, true);
  assert.equal(nativeFfmpegPlan({ VDF_NATIVE_FFMPEG: " On " }, () => false).enabled, true);
});

test("only the scan process sees the FFmpeg 8 libraries", () => {
  const plan = { enabled: true, libDir: "/opt/ffmpeg/lib" };
  assert.deepEqual(nativeFfmpegEnv(plan, { PATH: "/usr/bin" }, "linux"), { PATH: "/usr/bin", LD_LIBRARY_PATH: "/opt/ffmpeg/lib" });
  assert.equal(nativeFfmpegEnv(plan, { LD_LIBRARY_PATH: "/x" }, "linux")?.LD_LIBRARY_PATH, "/opt/ffmpeg/lib:/x");
  assert.equal(nativeFfmpegEnv({ enabled: false, libDir: "/opt/ffmpeg/lib" }, {}, "linux"), undefined);
  assert.equal(nativeFfmpegEnv({ enabled: true, libDir: null }, {}, "linux"), undefined);
  assert.equal(nativeFfmpegEnv(plan, {}, "win32"), undefined);
});

test("a failed native scan is tried once more without it, unless it was cancelled or never started", () => {
  const on = { enabled: true, libDir: null };
  assert.equal(shouldRetryWithoutNative(on, { code: 1, spawnFailed: false }, false), true);
  assert.equal(shouldRetryWithoutNative(on, { code: null, spawnFailed: false }, false), true);
  assert.equal(shouldRetryWithoutNative(on, { code: 0, spawnFailed: false }, false), false);
  assert.equal(shouldRetryWithoutNative(on, { code: 1, spawnFailed: false }, true), false);
  assert.equal(shouldRetryWithoutNative(on, { code: null, spawnFailed: true }, false), false);
  assert.equal(shouldRetryWithoutNative({ enabled: false, libDir: null }, { code: 1, spawnFailed: false }, false), false);
});

test("the scan gets --native-ffmpeg only when asked", () => {
  const base = { ...defaultScan(), includes: ["/media"], excludes: [], dbDir: "/data/db", settingsFile: "/data/s.json" };
  assert.equal(buildVdfScanArgs(base).includes("--native-ffmpeg"), false);
  assert.equal(buildVdfScanArgs({ ...base, nativeFfmpeg: false }).includes("--native-ffmpeg"), false);
  assert.equal(buildVdfScanArgs({ ...base, nativeFfmpeg: true }).includes("--native-ffmpeg"), true);
});
