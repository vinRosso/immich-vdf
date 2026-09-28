import assert from "node:assert/strict";
import test from "node:test";
import { cliAvailable, pathExecutableCandidates } from "../src/lib/config";

test("pathExecutableCandidates includes PATHEXT on Windows", () => {
  if (process.platform !== "win32") return;
  const prev = process.env.PATHEXT;
  process.env.PATHEXT = ".EXE;.CMD;.BAT";
  try {
    const names = pathExecutableCandidates("vdf-cli");
    assert.ok(names.some((name) => name.toLowerCase() === "vdf-cli.cmd"));
    assert.ok(names.some((name) => name.toLowerCase() === "vdf-cli.exe"));
  } finally {
    process.env.PATHEXT = prev;
  }
});

test("cliAvailable finds cmd.exe on Windows PATH", () => {
  if (process.platform !== "win32") return;
  assert.equal(cliAvailable("cmd"), true);
});
