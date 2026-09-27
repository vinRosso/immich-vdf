import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCliResults, parseTimeSpan } from "../src/lib/parse-results";

test("fixture matches the v4.1.1 CLI group shape", () => {
  const groups = parseCliResults(readFileSync("fixtures/cli-results.json", "utf8"));
  assert.equal(groups.length, 2);
  assert.equal(groups[0].groupId, "11111111-1111-1111-1111-111111111111");
  assert.equal(groups[0].items[0].path, "/media/library/holiday-1080p.mp4");
  assert.equal(groups[0].items[0].similarity, 99.2);
  assert.equal(groups[0].items[0].sizeBytes, 524288000);
  assert.equal(groups[0].items[0].durationSeconds, 90);
  assert.equal(groups[0].items[0].resolution, "1920x1080");
  assert.equal(groups[0].items[0].bitrateKbps, 8000);
  assert.equal(groups[0].items[0].audioBitrateKbps, 192);
  assert.equal(groups[0].items[0].dateCreatedMs, Date.parse("2025-01-01T00:00:00Z"));
  assert.deepEqual(groups[0].items[0].flags, []);
  assert.equal(groups[0].items[1].durationSeconds, 90.5);
  const clip = groups[1].items[1];
  assert.equal(clip.partialClipOffsetSeconds, 125);
  assert.deepEqual(clip.flags, ["PartialClip", "AiMatched"]);
});

test("parser rejects a renamed contract and accepts an empty scan", () => {
  assert.throws(() => parseCliResults("{}"), /array of groups/);
  assert.throws(() => parseCliResults(JSON.stringify([{ Items: [] }])), /GroupId/);
  assert.deepEqual(parseCliResults("[]"), []);
});

test("TimeSpan with a day component", () => {
  assert.equal(parseTimeSpan("1.02:03:04.5", "item", "Duration"), 86400 + 2 * 3600 + 3 * 60 + 4.5);
});
