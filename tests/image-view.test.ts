import assert from "node:assert/strict";
import test from "node:test";
import {
  clampImageView,
  DEFAULT_RELATIVE_IMAGE_VIEW,
  fitImage,
  relativeToView,
  viewToRelative,
  zoomImage,
} from "../src/lib/image-view";

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

test("relative view round-trips through different image sizes", () => {
  const viewport = { viewportWidth: 400, viewportHeight: 300 };
  const portrait = { ...viewport, imageWidth: 3000, imageHeight: 4000 };
  const landscape = { ...viewport, imageWidth: 4000, imageHeight: 3000 };
  const start = zoomImage(fitImage(400, 300, 3000, 4000), 200, 150, 2, portrait);
  const relative = viewToRelative(start, portrait);
  assert.ok(relative.zoomRatio > 1.9 && relative.zoomRatio < 2.1);
  const onLandscape = relativeToView(relative, landscape);
  const back = viewToRelative(onLandscape, landscape);
  assert.ok(Math.abs(back.zoomRatio - relative.zoomRatio) < 0.001);
  assert.ok(Math.abs(back.focusX - relative.focusX) < 0.001);
  assert.ok(Math.abs(back.focusY - relative.focusY) < 0.001);
});

test("default relative view matches fit", () => {
  const bounds = { viewportWidth: 200, viewportHeight: 100, imageWidth: 400, imageHeight: 200 };
  const fit = fitImage(200, 100, 400, 200);
  const fromDefault = relativeToView(DEFAULT_RELATIVE_IMAGE_VIEW, bounds);
  assert.equal(fromDefault.scale, fit.scale);
  assert.equal(fromDefault.x, fit.x);
  assert.equal(fromDefault.y, fit.y);
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
