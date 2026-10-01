import assert from "node:assert/strict";
import test from "node:test";
import { formatTimeZone, listTimeZones, timeZoneMatches } from "../src/lib/time-zones";

test("timezone list starts with UTC and includes city zones", () => {
  const zones = listTimeZones();
  assert.equal(zones[0], "UTC");
  assert.ok(zones.includes("Europe/Rome"));
  assert.ok(zones.includes("America/Los_Angeles"));
  assert.ok(zones.length > 100);
});

test("timezone search matches names with spaces", () => {
  assert.equal(timeZoneMatches("Europe/Rome", "rome"), true);
  assert.equal(timeZoneMatches("America/Los_Angeles", "los angeles"), true);
  assert.equal(formatTimeZone("America/Los_Angeles"), "America/Los Angeles");
  assert.equal(timeZoneMatches("Asia/Tokyo", "rome"), false);
});
