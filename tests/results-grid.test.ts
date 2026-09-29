import assert from "node:assert/strict";
import test from "node:test";
import { resultsCardGridClass, resultsGridColumns, resultsGridGap, visibleRowRange } from "../src/lib/results-sort";

test("results grid columns follow the card size breakpoints", () => {
  assert.equal(resultsGridColumns(5, 500), 2);
  assert.equal(resultsGridColumns(5, 640), 4);
  assert.equal(resultsGridColumns(5, 1024), 5);
  assert.equal(resultsGridColumns(5, 1280), 6);
  assert.match(resultsCardGridClass(5), /xl:grid-cols-6/);
  assert.equal(resultsGridGap(5), 8);
  assert.equal(resultsGridGap(1), 16);
});

test("visible rows include an overscan band and skip content above the grid", () => {
  const hidden = visibleRowRange({
    scrollTop: 0,
    viewportHeight: 800,
    gridTop: 2000,
    rowStride: 200,
    rowCount: 40,
    overscan: 2,
  });
  assert.deepEqual(hidden, { startRow: 0, endRow: 0 });

  const visible = visibleRowRange({
    scrollTop: 2000,
    viewportHeight: 800,
    gridTop: 2000,
    rowStride: 200,
    rowCount: 40,
    overscan: 1,
  });
  assert.deepEqual(visible, { startRow: 0, endRow: 5 });
});
