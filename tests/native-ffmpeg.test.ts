import assert from "node:assert/strict";
import test from "node:test";
import { buildVdfScanArgs } from "../src/lib/cli-args";
import {
  nativeFfmpegEnv,
  nativeFfmpegMode,
  resolveNativeFfmpeg,
  shouldRetryWithoutNative,
  type NativeFfmpegDeps,
  type NativeState,
} from "../src/lib/native-ffmpeg";
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

test("the default is automatic", () => {
  assert.deepEqual(nativeFfmpegMode({}, () => false), { kind: "auto", libDir: null });
});

test("an image built without its libraries scans with the ffmpeg program and never downloads", () => {
  const env = { VDF_FFMPEG_LIBS: "/opt/ffmpeg/lib" };
  assert.deepEqual(nativeFfmpegMode(env, folderWith([])), { kind: "off", libDir: "/opt/ffmpeg/lib", imageLibsMissing: true });
});

test("the image's libraries turn it on without a check only when every one is there", () => {
  const env = { VDF_FFMPEG_LIBS: "/opt/ffmpeg/lib" };
  assert.deepEqual(nativeFfmpegMode(env, folderWith(libs)), { kind: "on", libDir: "/opt/ffmpeg/lib" });
  assert.equal(nativeFfmpegMode(env, folderWith(libs.slice(1))).kind, "off");
});

test("VDF_NATIVE_FFMPEG turns it off or forces it on", () => {
  const env = { VDF_FFMPEG_LIBS: "/opt/ffmpeg/lib" };
  assert.equal(nativeFfmpegMode({ ...env, VDF_NATIVE_FFMPEG: "0" }, folderWith(libs)).kind, "off");
  assert.equal(nativeFfmpegMode({ VDF_NATIVE_FFMPEG: "false" }, () => false).kind, "off");
  assert.equal(nativeFfmpegMode({ VDF_NATIVE_FFMPEG: "1" }, () => false).kind, "on");
  assert.equal(nativeFfmpegMode({ VDF_NATIVE_FFMPEG: " On " }, () => false).kind, "on");
});

function fakeDeps(options: { available: boolean; installs?: boolean; installedAvailable?: boolean }) {
  const calls = { probe: 0, install: 0, log: [] as string[] };
  let installed = false;
  const deps: NativeFfmpegDeps = {
    probe: async () => {
      calls.probe += 1;
      return installed ? (options.installedAvailable ?? true) : options.available;
    },
    install: async () => {
      calls.install += 1;
      installed = options.installs ?? true;
      return options.installs ?? true;
    },
    log: (line) => calls.log.push(line),
  };
  return { deps, calls };
}

const fresh = (): NativeState => ({ available: false, failedAt: null });

test("an explicit setting never checks or downloads", async () => {
  const off = fakeDeps({ available: false });
  assert.deepEqual(await resolveNativeFfmpeg(off.deps, { VDF_NATIVE_FFMPEG: "0" }, () => false, fresh()), { enabled: false, libDir: null });
  const forced = fakeDeps({ available: false });
  assert.deepEqual(await resolveNativeFfmpeg(forced.deps, { VDF_NATIVE_FFMPEG: "1" }, () => false, fresh()), { enabled: true, libDir: null });
  assert.equal(off.calls.probe + off.calls.install + forced.calls.probe + forced.calls.install, 0);
});

test("an image without its libraries uses the ffmpeg program, says so, and never downloads", async () => {
  const { deps, calls } = fakeDeps({ available: false });
  const plan = await resolveNativeFfmpeg(deps, { VDF_FFMPEG_LIBS: "/opt/ffmpeg/lib" }, folderWith([]), fresh());
  assert.deepEqual(plan, { enabled: false, libDir: "/opt/ffmpeg/lib" });
  assert.equal(calls.probe + calls.install, 0);
  assert.ok(calls.log.some((line) => /no FFmpeg 8 libraries/.test(line)));
});

test("libraries that are already there are used and not downloaded", async () => {
  const { deps, calls } = fakeDeps({ available: true });
  const state = fresh();
  assert.equal((await resolveNativeFfmpeg(deps, {}, () => false, state)).enabled, true);
  assert.equal(calls.install, 0);
  // Remembered, so later scans do not start a process to ask again.
  assert.equal((await resolveNativeFfmpeg(deps, {}, () => false, state)).enabled, true);
  assert.equal(calls.probe, 1);
});

test("missing libraries are downloaded once and then used", async () => {
  const { deps, calls } = fakeDeps({ available: false });
  const plan = await resolveNativeFfmpeg(deps, {}, () => false, fresh());
  assert.equal(plan.enabled, true);
  assert.equal(calls.install, 1);
  assert.equal(calls.probe, 2);
  assert.ok(calls.log.some((line) => /Downloading them once/.test(line)));
  assert.ok(calls.log.some((line) => /is installed/.test(line)));
});

test("a failed download falls back to the ffmpeg program and is not retried for hours", async () => {
  let clock = 1_000_000;
  const { deps, calls } = fakeDeps({ available: false, installs: false });
  deps.now = () => clock;
  const state = fresh();

  assert.equal((await resolveNativeFfmpeg(deps, {}, () => false, state)).enabled, false);
  assert.equal(calls.install, 1);
  assert.ok(calls.log.some((line) => /could not be installed/.test(line)));

  clock += 60 * 60 * 1000;
  assert.equal((await resolveNativeFfmpeg(deps, {}, () => false, state)).enabled, false);
  assert.equal(calls.install, 1, "no second download within the waiting time");
  assert.ok(calls.log.some((line) => /the last download failed/.test(line)));

  clock += 6 * 60 * 60 * 1000;
  assert.equal((await resolveNativeFfmpeg(deps, {}, () => false, state)).enabled, false);
  assert.equal(calls.install, 2, "tried again after the waiting time");
});

test("a download that gives libraries that still cannot load falls back", async () => {
  const { deps, calls } = fakeDeps({ available: false, installs: true, installedAvailable: false });
  assert.equal((await resolveNativeFfmpeg(deps, {}, () => false, fresh())).enabled, false);
  assert.equal(calls.install, 1);
});

test("libraries put in place by hand are picked up even after a failed download", async () => {
  let present = false;
  const { deps, calls } = fakeDeps({ available: false, installs: false });
  deps.probe = async () => present;
  const state = fresh();
  assert.equal((await resolveNativeFfmpeg(deps, {}, () => false, state)).enabled, false);
  present = true;
  assert.equal((await resolveNativeFfmpeg(deps, {}, () => false, state)).enabled, true);
  assert.equal(calls.install, 1);
});

test("a cancelled scan does not count as a failed download", async () => {
  const { deps } = fakeDeps({ available: false, installs: false });
  deps.cancelled = () => true;
  const state = fresh();
  assert.equal((await resolveNativeFfmpeg(deps, {}, () => false, state)).enabled, false);
  assert.equal(state.failedAt, null);
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
  // Hashing is where the libraries are used; a later failure would only repeat.
  assert.equal(shouldRetryWithoutNative(on, { code: 1, spawnFailed: false, hashingDone: false }, false), true);
  assert.equal(shouldRetryWithoutNative(on, { code: 137, spawnFailed: false, hashingDone: true }, false), false);
  assert.equal(shouldRetryWithoutNative({ enabled: false, libDir: null }, { code: 1, spawnFailed: false }, false), false);
});

test("the scan gets --native-ffmpeg only when asked", () => {
  const base = { ...defaultScan(), includes: ["/media"], excludes: [], dbDir: "/data/db", settingsFile: "/data/s.json" };
  assert.equal(buildVdfScanArgs(base).includes("--native-ffmpeg"), false);
  assert.equal(buildVdfScanArgs({ ...base, nativeFfmpeg: false }).includes("--native-ffmpeg"), false);
  assert.equal(buildVdfScanArgs({ ...base, nativeFfmpeg: true }).includes("--native-ffmpeg"), true);
});
