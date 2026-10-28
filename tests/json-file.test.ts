import assert from "node:assert/strict";
import { copyFile, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

test("writeJson from two module copies keeps the file valid", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vdf-json-"));
  const file = path.join(dir, "shared.json");
  type Copy = typeof import("../src/lib/json-file");
  // tsx ignores query strings, so a second real copy of the module is loaded from a copied file.
  const second = path.join(dir, "json-file-copy.ts");
  await copyFile(path.join(process.cwd(), "src/lib/json-file.ts"), second);
  const copies = [await import("../src/lib/json-file"), (await import(pathToFileURL(second).href)) as Copy] as Copy[];
  assert.notEqual(copies[0].exclusive, copies[1].exclusive);
  const runs = Array.from({ length: 40 }, (_, i) => {
    const copy = copies[i % 2];
    return copy.exclusive(() => copy.writeJson(file, { n: i, pad: "x".repeat(20000 * (i % 3)) }));
  });
  await Promise.all(runs);
  const saved = JSON.parse(await readFile(file, "utf8")) as { n: number };
  assert.ok(saved.n >= 0 && saved.n < 40);
  assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), []);
});
