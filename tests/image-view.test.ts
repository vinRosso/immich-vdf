import assert from "node:assert/strict";
import test from "node:test";
import { clampImageView, fitImage, zoomImage } from "../src/lib/image-view";

test("fit centers an image inside the viewport", () => {
  const view = fitImage(200, 100, 100, 100);
  assert.equal(view.scale, 1);
  assert.equal(view.x, 50);
  assert.equal(view.y, 0);
});

test("zoom keeps the cursor on the same image pixel", () => {
  const start = { scale: 1, x: 10, y: 20 };
  const next = zoomImage(start, 40, 50, 2);
  const imageX = (40 - start.x) / start.scale;
  const imageY = (50 - start.y) / start.scale;
  assert.equal(next.scale, 2);
  assert.equal((40 - next.x) / next.scale, imageX);
  assert.equal((50 - next.y) / next.scale, imageY);
});

test("pan anchors image borders to the canvas", () => {
  const bounds = { viewportWidth: 200, viewportHeight: 100, imageWidth: 100, imageHeight: 100 };
  const letterboxed = clampImageView({ scale: 1, x: -40, y: 10 }, bounds);
  assert.equal(letterboxed.x, 50);
  assert.equal(letterboxed.y, 0);

  const covered = clampImageView({ scale: 2, x: 30, y: -500 }, bounds);
  assert.equal(covered.x, 0);
  assert.equal(covered.y, -100);
});
