import assert from "node:assert/strict";
import test from "node:test";
import { imageBitDepthFromFfprobe } from "../src/lib/image-bit-depth";

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
