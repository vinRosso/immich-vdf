import assert from "node:assert/strict";
import test from "node:test";
import { ffprobeBitDepthArgs } from "../src/lib/ffmpeg-args";
import { bitDepthFromHeader, imageBitDepthFromFfprobe } from "../src/lib/image-bit-depth";

test("ffprobe bit depth prefers bits_per_raw_sample", () => {
  const depth = imageBitDepthFromFfprobe({
    streams: [{ codec_type: "video", bits_per_raw_sample: 16, pix_fmt: "rgb24" }],
  });
  assert.equal(depth, 16);
});

test("ffprobe bit depth falls back to pix_fmt", () => {
  const depth = imageBitDepthFromFfprobe({
    streams: [{ codec_type: "video", pix_fmt: "rgba64le" }],
  });
  assert.equal(depth, 16);
});

test("jpeg header bit depth is the SOF precision, after skipped segments", () => {
  const jpeg = Buffer.from([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x0c, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x00,
  ]);
  assert.equal(bitDepthFromHeader(jpeg), 12);
});

test("png header bit depth is the IHDR sample size", () => {
  const png = Buffer.alloc(25);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 0);
  png[24] = 16;
  assert.equal(bitDepthFromHeader(png), 16);
});

test("gif header bit depth is 8", () => {
  assert.equal(bitDepthFromHeader(Buffer.from("GIF89a")), 8);
});

test("bit depth ffprobe stops after a short header instead of the 5 MB default", () => {
  const args = ffprobeBitDepthArgs("/library/a.heic");
  assert.equal(args[args.indexOf("-probesize") + 1], "262144");
  assert.equal(args[args.indexOf("-analyzeduration") + 1], "200000");
  assert.equal(args.at(-1), "/library/a.heic");
});

test("a short jpeg asks for more bytes, and other files are unknown", () => {
  assert.equal(bitDepthFromHeader(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20])), "more");
  assert.equal(bitDepthFromHeader(Buffer.alloc(16)), "unknown");
});
