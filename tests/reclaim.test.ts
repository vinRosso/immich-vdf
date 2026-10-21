import assert from "node:assert/strict";
import { test } from "node:test";
import { groupReclaimBytes, totalReclaimBytes } from "../src/lib/reclaim";

function item(width: number, height: number, sizeBytes: number) {
  return { bitrateKbps: 0, bitDepth: 8, isImage: true, width, height, sizeBytes };
}

test("groupReclaimBytes counts every file except the best one", () => {
  const items = [item(1280, 720, 400), item(1920, 1080, 900), item(640, 360, 100)];
  assert.equal(groupReclaimBytes(items), 500);
});

test("groupReclaimBytes is zero for an empty or single-file group", () => {
  assert.equal(groupReclaimBytes([]), 0);
  assert.equal(groupReclaimBytes([item(100, 100, 50)]), 0);
});

test("totalReclaimBytes adds up the groups", () => {
  const groups = [
    { items: [item(1920, 1080, 900), item(640, 360, 100)] },
    { items: [item(800, 600, 30), item(800, 600, 20)] },
  ];
  assert.equal(totalReclaimBytes(groups), 100 + 30);
});
