import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readJson } from "../src/lib/json-file";

test("readJson uses the fallback only when the file is missing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vdf-json-"));
  const missing = path.join(dir, "missing.json");
  const broken = path.join(dir, "broken.json");
  await writeFile(broken, "{");
  assert.deepEqual(await readJson(missing, { ok: true }), { ok: true });
  await assert.rejects(() => readJson(broken, { ok: true }));
});
