import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ipInCidr, isTrustedProxyCidr } from "../src/lib/cidr";
import { buildVdfArgs } from "../src/lib/cli-args";
import { filmstripArgs, posterArgs, transcodeArgs } from "../src/lib/ffmpeg-args";
import { ignoreKey, memberIds, pruneIgnoredEntries } from "../src/lib/ignore";
import { isInside, resolveInside } from "../src/lib/path-jail";
import { parseByteRange } from "../src/lib/range";
import { redact } from "../src/lib/redact";
import { passwordIsAcceptable } from "../src/lib/password";
import { loginAllowed, recordLoginFailure } from "../src/lib/rate-limit";
import { mutationSiteAllowed, originMatchesHost, stripUntrustedForwarding } from "../src/lib/request-meta";
import { cookieIsValid, issueToken, passwordsMatch, resetSessionCachesForTests, revokeToken, sessionEpoch, sessionSecret, verifyToken } from "../src/lib/session";
import { assertFetchTarget, fetchInitForRedirect, assertHttpUrl, ipIsBlockedTarget } from "../src/lib/urls";
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
  assert.equal(ipInCidr("1.2.3.4", "0.0.0.0/0"), false);
  assert.equal(isTrustedProxyCidr("10.0.0.0/8"), true);
  assert.equal(isTrustedProxyCidr("172.16.0.0/12"), true);
  assert.equal(isTrustedProxyCidr("0.0.0.0/0"), false);
  assert.equal(isTrustedProxyCidr("0.0.0.0/8"), false);
  assert.equal(isTrustedProxyCidr("1.0.0.0/7"), false);
});

test("redirects to another host drop API credentials", () => {
  const init = { headers: { "x-api-key": "secret", accept: "application/json" } };
  const same = fetchInitForRedirect(init, new URL("https://immich.local/api"), new URL("https://immich.local/v2"));
  assert.equal(new Headers(same.headers).get("x-api-key"), "secret");
  const other = fetchInitForRedirect(init, new URL("https://immich.local/api"), new URL("https://evil.example/api"));
  const headers = new Headers(other.headers);
  assert.equal(headers.get("x-api-key"), null);
  assert.equal(headers.get("accept"), "application/json");
});

test("origin must match the request host when it is sent", () => {
  assert.equal(originMatchesHost(null, "localhost:47821"), true);
  assert.equal(originMatchesHost("http://localhost:47821", "localhost:47821"), true);
  assert.equal(originMatchesHost("https://evil.example", "localhost:47821"), false);
  assert.equal(mutationSiteAllowed({ referer: "http://localhost:47821/immich", host: "localhost:47821" }), true);
  assert.equal(mutationSiteAllowed({ referer: "https://evil.example/immich", host: "localhost:47821" }), false);
  assert.equal(mutationSiteAllowed({ host: "localhost:47821" }), false);
});

test("logout revokes that session token", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vdf-session-"));
  const previousDir = process.env.DATA_DIR;
  const previousPassword = process.env.APP_PASSWORD;
  process.env.DATA_DIR = dir;
  process.env.APP_PASSWORD = "correct-horse-battery";
  resetSessionCachesForTests();
  try {
    const secret = await sessionSecret();
    const epoch = await sessionEpoch();
    const token = issueToken(secret, Date.now() + 60_000, epoch);
    assert.equal(verifyToken(secret, token, Date.now(), epoch), true);
    assert.equal(await cookieIsValid(`vdf_session=${token}`), true);
    await revokeToken(token);
    assert.equal(await cookieIsValid(`vdf_session=${token}`), false);
  } finally {
    if (previousDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDir;
    if (previousPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previousPassword;
    resetSessionCachesForTests();
  }
});

test("changing APP_PASSWORD revokes sessions that are already signed in", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vdf-epoch-"));
  const previousDir = process.env.DATA_DIR;
  const previousPassword = process.env.APP_PASSWORD;
  process.env.DATA_DIR = dir;
  process.env.APP_PASSWORD = "correct-horse-battery";
  resetSessionCachesForTests();
  try {
    const secret = await sessionSecret();
    const token = issueToken(secret, Date.now() + 60_000, await sessionEpoch());
    assert.equal(await cookieIsValid(`vdf_session=${token}`), true);
    process.env.APP_PASSWORD = "correct-horse-staple";
    assert.equal(await cookieIsValid(`vdf_session=${token}`), false);
  } finally {
    if (previousDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDir;
    if (previousPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previousPassword;
    resetSessionCachesForTests();
  }
});

test("login lockout survives a new check and change-me is refused", async () => {
  assert.equal(passwordIsAcceptable("change-me"), false);
  assert.equal(passwordIsAcceptable("Change-Me"), false);
  assert.equal(passwordIsAcceptable("short"), false);
  assert.equal(passwordIsAcceptable("12345678"), true);
  const dir = await mkdtemp(path.join(tmpdir(), "vdf-login-"));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) await recordLoginFailure("203.0.113.8");
    const blocked = await loginAllowed("203.0.113.8");
    assert.equal(blocked.ok, false);
    assert.equal((await loginAllowed("203.0.113.9")).ok, true);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
  }
});

test("fetch targets block loopback and metadata, and keep private LAN addresses", async () => {
  assert.equal(ipIsBlockedTarget("127.0.0.1"), true);
  assert.equal(ipIsBlockedTarget("169.254.169.254"), true);
  assert.equal(ipIsBlockedTarget("10.1.2.3"), false);
  assert.equal(ipIsBlockedTarget("192.168.1.20"), false);
  await assert.rejects(() => assertFetchTarget("http://127.0.0.1/"), /not allowed/);
  await assert.rejects(() => assertFetchTarget("http://2130706433/"), /not allowed/);
  await assert.rejects(() => assertFetchTarget("http://localhost/"), /not allowed/);
  const lan = await assertFetchTarget("http://10.1.2.3:2283/");
  assert.equal(lan.hostname, "10.1.2.3");
});

test("forwarding headers are ignored from an untrusted peer", () => {
  const previous = process.env.TRUSTED_PROXY_CIDR;
  process.env.TRUSTED_PROXY_CIDR = "";
  const request = {
    socket: { remoteAddress: "203.0.113.5" },
    headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https", host: "localhost:4747" },
  };
  stripUntrustedForwarding(request as never);
  assert.equal(request.headers["x-forwarded-host"], undefined);
  assert.equal(request.headers.host, "localhost:4747");
  if (previous === undefined) delete process.env.TRUSTED_PROXY_CIDR;
  else process.env.TRUSTED_PROXY_CIDR = previous;
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
    timeWindowDays: 0,
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
