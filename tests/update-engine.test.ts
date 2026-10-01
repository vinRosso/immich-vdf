import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEngineTag, renderUpstreamPin } from "../scripts/update-engine";

describe("parseEngineTag", () => {
  it("accepts a v-prefixed release tag", () => {
    assert.deepEqual(parseEngineTag("v4.1.1"), { tag: "v4.1.1", version: "4.1.1" });
  });

  it("adds the missing v", () => {
    assert.deepEqual(parseEngineTag("4.2.0"), { tag: "v4.2.0", version: "4.2.0" });
  });

  it("rejects a branch name", () => {
    assert.throws(() => parseEngineTag("master"), /version tag/);
  });
});

describe("renderUpstreamPin", () => {
  it("writes stable json", () => {
    const text = renderUpstreamPin({
      repository: "https://github.com/0x90d/videoduplicatefinder",
      tag: "v4.1.1",
      commit: "21ec967e2e108bb9a2f09f937be000fb1e2c3615",
      version: "4.1.1",
    });
    assert.equal(JSON.parse(text).version, "4.1.1");
  });
});
