import assert from "node:assert/strict";
import test from "node:test";
import { applyScanProfile, detectScanProfile } from "../src/lib/scan-profiles";
import { defaultScan } from "../src/lib/scan-defaults";

test("scan profiles round-trip detect after apply", () => {
  const base = defaultScan();
  const edited = applyScanProfile(base, "edited");
  assert.equal(edited.compareHorizontallyFlipped, true);
  assert.equal(edited.ignoreBlackPixels, true);
  assert.equal(detectScanProfile(edited), "edited");
  const deep = applyScanProfile(base, "deep");
  assert.equal(deep.partialClip, true);
  assert.equal(deep.aiMatching, true);
  assert.equal(detectScanProfile(deep), "deep");
});
