import assert from "node:assert/strict";
import test from "node:test";
import { warmPlan } from "../src/lib/thumb-warm";
import type { StoredItem } from "../src/lib/types";

function item(path: string, assetId: string | null = null, stackPrimary = false): StoredItem {
  return {
    path,
    similarity: 100,
    sizeBytes: 1,
    durationSeconds: 0,
    resolution: null,
    width: 0,
    height: 0,
    bitrateKbps: 0,
    bitDepth: 0,
    audioBitrateKbps: 0,
    dateCreatedMs: 0,
    flags: [],
    partialClipOffsetSeconds: 0,
    isImage: true,
    format: null,
    fps: 0,
    assetId,
    originalPath: null,
    stackPrimary,
  };
}

const posters = (tasks: { kind: string; path: string }[]) => tasks.filter((task) => task.kind === "poster").map((task) => task.path);

test("warm-up renders every group's cover poster first, then videos, then the other posters", () => {
  const groups = [
    { groupId: "a", items: [item("a1"), item("a2", null, true)] },
    { groupId: "b", items: [{ ...item("b1"), isImage: false }, item("b2")] },
  ];
  const plan = warmPlan("server", { groups });
  assert.deepEqual(
    plan.map((task) => `${task.kind}:${task.path}`),
    ["poster:a2", "poster:b1", "probe:b1", "strip:b1", "poster:a1", "poster:b2"],
  );
});

test("warm-up skips Immich assets, whose posters come from the Immich API, but not their videos", () => {
  const groups = [
    { groupId: "a", items: [item("a1", "asset-1"), item("a2")] },
    { groupId: "b", items: [{ ...item("v1", "asset-2"), isImage: false }] },
  ];
  assert.deepEqual(posters(warmPlan("immich", { groups })), ["a2"]);
  assert.deepEqual(posters(warmPlan("server", { groups })), ["a1", "v1", "a2"]);
  assert.deepEqual(
    warmPlan("immich", { groups }).filter((task) => task.path === "v1").map((task) => task.kind),
    ["probe", "strip"],
  );
});
