import assert from "node:assert/strict";
import test from "node:test";
import { formatCompactThousands } from "../src/lib/format";

test("formatCompactThousands rounds to thousands", () => {
  assert.equal(formatCompactThousands(0), "< 1k");
  assert.equal(formatCompactThousands(999), "< 1k");
  assert.equal(formatCompactThousands(1000), "1k");
  assert.equal(formatCompactThousands(43000), "43k");
  assert.equal(formatCompactThousands(35121), "35k");
});
