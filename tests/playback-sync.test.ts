import assert from "node:assert/strict";
import test from "node:test";
import { driftAction } from "../src/lib/playback-sync";

test("direct playback jumps the follower when it drifts", () => {
  assert.equal(driftAction(0.4, true, false), "jump");
  assert.equal(driftAction(-0.4, true, false), "jump");
  assert.equal(driftAction(0.05, true, false), "resume");
});

test("transcoded playback holds whichever side is ahead", () => {
  assert.equal(driftAction(0.5, false, false), "hold-follower");
  assert.equal(driftAction(-0.5, false, false), "hold-leader");
  assert.equal(driftAction(0.2, false, false), "wait");
  assert.equal(driftAction(0.05, false, false), "resume");
});

test("a user pause is left alone", () => {
  assert.equal(driftAction(1, true, true), "wait");
  assert.equal(driftAction(-1, false, true), "wait");
});
