import assert from "node:assert/strict";
import test from "node:test";
import { loginUrlForPath, safeLoginNext } from "../src/lib/auth-redirect";

test("loginUrlForPath encodes the return path", () => {
  assert.equal(loginUrlForPath("/immich"), "/login?next=%2Fimmich");
  assert.equal(loginUrlForPath("/immich", "?tab=1"), "/login?next=%2Fimmich%3Ftab%3D1");
  assert.equal(loginUrlForPath("/login"), "/login");
});

test("safeLoginNext rejects open redirects", () => {
  assert.equal(safeLoginNext("/immich"), "/immich");
  assert.equal(safeLoginNext("//evil.test"), null);
  assert.equal(safeLoginNext("/login"), null);
  assert.equal(safeLoginNext("https://evil.test"), null);
  assert.equal(safeLoginNext("/\\evil.test"), null);
  assert.equal(safeLoginNext("/%5Cevil.test"), null);
  assert.equal(safeLoginNext("/immich?tab=1"), "/immich?tab=1");
});
