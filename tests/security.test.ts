import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ipInCidr } from "../src/lib/cidr";
import { buildVdfArgs } from "../src/lib/cli-args";
import { filmstripArgs, posterArgs, transcodeArgs } from "../src/lib/ffmpeg-args";
import { ignoreKey, memberIds, pruneIgnoredEntries } from "../src/lib/ignore";
import { isInside, resolveInside } from "../src/lib/path-jail";
import { parseByteRange } from "../src/lib/range";
import { redact } from "../src/lib/redact";
import { issueToken, passwordsMatch, verifyToken } from "../src/lib/session";
import { assertHttpUrl } from "../src/lib/urls";
import type { StoredItem } from "../src/lib/types";

test("path jail follows symlinks and refuses an escape", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vdf-jail-"));
  const inside = path.join(root, "library");
  const outside = await mkdtemp(path.join(tmpdir(), "vdf-out-"));
  await mkdir(inside);
  await writeFile(path.join(inside, "clip.mp4"), "x");
  await symlink(outside, path.join(inside, "escape"));
  const real = await resolveInside([root], path.join(inside, "clip.mp4"));
  assert.equal(isInside(root, real), true);
  await assert.rejects(() => resolveInside([root], path.join(inside, "escape")), /outside/);
  await assert.rejects(() => resolveInside([root], "/etc"), /outside/);
});

test("session token expires and rejects tampering", () => {
  const secret = "a".repeat(32);
  const token = issueToken(secret, Date.now() + 1000);
  assert.equal(verifyToken(secret, token), true);
  assert.equal(verifyToken(secret, token, Date.now() + 5000), false);
  assert.equal(verifyToken("b".repeat(32), token), false);
  const [payload, signature] = token.split(".");
  assert.equal(verifyToken(secret, `${payload}.${signature.slice(0, -1)}x`), false);
  assert.equal(passwordsMatch("local-dev", "local-dev"), true);
  assert.equal(passwordsMatch("local-dev", "other"), false);
});

test("secrets are redacted and short strings are left alone", () => {
  const text = "key sk-live-secret-value and hook https://hooks.example/very-secret-path";
  const clean = redact(text, ["sk-live-secret-value", "https://hooks.example/very-secret-path", "no"]);
  assert.equal(clean.includes("sk-live"), false);
  assert.equal(clean.includes("very-secret-path"), false);
  assert.match(clean, /\[redacted\]/);
});

test("urls must be http or https without credentials", () => {
  assert.equal(assertHttpUrl("https://immich.local/api").protocol, "https:");
  assert.throws(() => assertHttpUrl("file:///etc/passwd"), /http or https/);
  assert.throws(() => assertHttpUrl("http://user:pass@immich.local"), /credentials/);
});

test("trusted proxy CIDR does not match a neighbor", () => {
  assert.equal(ipInCidr("10.1.2.3", "10.1.0.0/16"), true);
  assert.equal(ipInCidr("10.2.2.3", "10.1.0.0/16"), false);
  assert.equal(ipInCidr("::ffff:127.0.0.1", "127.0.0.1/32"), true);
});

test("byte ranges", () => {
  assert.deepEqual(parseByteRange("bytes=0-1", 10), { start: 0, end: 1 });
  assert.deepEqual(parseByteRange("bytes=8-", 10), { start: 8, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-4", 10), { start: 6, end: 9 });
  assert.equal(parseByteRange("bytes=20-30", 10), null);
});

test("ignore keys change when a member is added", () => {
  const item = (file: string, assetId: string | null): StoredItem => ({
    path: file,
    similarity: 1,
    sizeBytes: 1,
    durationSeconds: 1,
    resolution: null,
    width: 0,
    height: 0,
    bitrateKbps: 1,
    bitDepth: 0,
    audioBitrateKbps: 0,
    dateCreatedMs: 0,
    flags: [],
    partialClipOffsetSeconds: 0,
    isImage: false,
    format: null,
    fps: 0,
    assetId,
    originalPath: null,
  });
  const first = ignoreKey(memberIds("immich", [item("/a", "one"), item("/b", "two")]));
  const grown = ignoreKey(memberIds("immich", [item("/a", "one"), item("/b", "two"), item("/c", "three")]));
  assert.notEqual(first, grown);
  assert.equal(ignoreKey(["b", "a"]), ignoreKey(["a", "b"]));
});

test("stale ignore entries drop when scan membership no longer matches", () => {
  const paths = ["/a.mkv", "/b.mkv"];
  const key = ignoreKey(paths);
  const entries = [{ key, ignoredAt: "2020-01-01T00:00:00.000Z", groupId: "g1", labels: ["a", "b"] }];
  const stillThere = pruneIgnoredEntries(
    "server",
    entries,
    [{ groupId: "g2", items: paths.map((file) => ({ path: file } as StoredItem)) }],
  );
  assert.equal(stillThere.length, 1);
  const restored = pruneIgnoredEntries(
    "server",
    entries,
    [{ groupId: "g3", items: [({ path: "/a.mkv" } as StoredItem), ({ path: "/b.mkv" } as StoredItem), ({ path: "/c.mkv" } as StoredItem)] }],
  );
  assert.equal(restored.length, 0);
});

test("CLI and ffmpeg arguments keep the path out of the shell and the filter", () => {
  const args = buildVdfArgs({
    includes: ["/media/a"],
    excludes: ["/media/a/skip"],
    threshold: 5,
    percent: 96,
    parallelism: 1,
    includeImages: true,
    usePhash: false,
    partialClip: true,
    aiMatching: false,
    aiPartial: false,
    compareHorizontallyFlipped: false,
    ignoreBlackPixels: false,
    ignoreWhitePixels: false,
    dbDir: "/data/db/server",
    outputFile: "/data/tmp/out.json",
    settingsFile: "/data/tmp/settings.json",
  });
  assert.equal(args[0], "scan-and-compare");
  assert.equal(args[args.indexOf("--include") + 1], "/media/a");
  assert.equal(args.includes("--native-ffmpeg"), false);
  assert.equal(args.join(" ").includes("&&"), false);
  const poster = posterArgs("/media/a clip.mp4", 1.5, "/data/thumbs/poster.jpg");
  assert.equal(poster[poster.indexOf("-i") + 1], "/media/a clip.mp4");
  assert.equal(poster[poster.indexOf("-vf") + 1], "scale=480:-2");
  assert.equal(poster.at(-1), "/data/thumbs/poster.jpg");
  const transcode = transcodeArgs("/media/file.mkv", 12, "transcode");
  assert.equal(transcode[transcode.indexOf("-vf") + 1], "scale=1280:720:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2");
  const preview = transcodeArgs("/media/file.mkv", 0, "transcode", undefined, 240);
  assert.equal(preview[preview.indexOf("-vf") + 1], "scale=426:240:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2");
  assert.equal(transcode.includes("pipe:1"), true);
  assert.equal(transcode[transcode.indexOf("-i") + 1], "/media/file.mkv");
  assert.equal(transcode[transcode.indexOf("-frag_duration") + 1], "500000");
  assert.equal(transcode.includes("expr:gte(t,n_forced*0.5)"), true);
  const remux = transcodeArgs("/media/file.mkv", 0, "remux");
  assert.equal(remux.includes("expr:gte(t,n_forced*0.5)"), false);
  assert.equal(remux[remux.indexOf("-frag_duration") + 1], "500000");
  assert.equal(filmstripArgs("/tmp/x", 0, "/tmp/y").includes("-ss"), false);
});
