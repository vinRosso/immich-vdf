import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { createBatchResolver, resolveAgainstRoots, resolveRoots } from "../src/lib/path-jail";

let base = "";
let root = "";
let outside = "";
let roots: string[] = [];

before(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "vdf-resolver-"));
  root = path.join(base, "library");
  outside = path.join(base, "elsewhere");
  await mkdir(path.join(root, "2024", "trip"), { recursive: true });
  await mkdir(path.join(root, "linked-in"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(root, "a.jpg"), "a");
  await writeFile(path.join(root, "2024", "trip", "b.mp4"), "b");
  await writeFile(path.join(root, "linked-in", "inner.jpg"), "inner");
  await writeFile(path.join(outside, "secret.jpg"), "secret");
  roots = await resolveRoots([root]);
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

async function outcome(run: () => Promise<string>): Promise<string> {
  try {
    return await run();
  } catch (error) {
    return `error: ${(error as Error).message}`;
  }
}

async function sameAsFullLookup(candidate: string): Promise<void> {
  const batch = createBatchResolver(roots);
  const first = await outcome(() => batch(candidate));
  const again = await outcome(() => batch(candidate));
  const expected = await outcome(() => resolveAgainstRoots(roots, candidate));
  assert.equal(first, expected, candidate);
  assert.equal(again, expected, `${candidate} (second time, from the folder cache)`);
}

test("files give the same answer as the full lookup", async () => {
  await sameAsFullLookup(path.join(root, "a.jpg"));
  await sameAsFullLookup(path.join(root, "2024", "trip", "b.mp4"));
  await sameAsFullLookup(path.join(root, "linked-in", "inner.jpg"));
});

test("missing files, bad paths and paths outside the folders fail the same way", async () => {
  await sameAsFullLookup(path.join(root, "nope.jpg"));
  await sameAsFullLookup(path.join(root, "no-such-folder", "x.jpg"));
  await sameAsFullLookup(path.join(outside, "secret.jpg"));
  await sameAsFullLookup("");
  await sameAsFullLookup(`${path.join(root, "a.jpg")}\0`);
});

test("paths that are not in normal form are resolved by the full lookup", async () => {
  await sameAsFullLookup(path.join(root, "2024", "..", "a.jpg"));
  await sameAsFullLookup(`${path.join(root, "2024")}${path.sep}.`);
  await sameAsFullLookup(path.join(root, "2024", "trip", "..", "..", "..", "elsewhere", "secret.jpg"));
});

test("a folder link that leaves the library is refused, and one that stays inside is followed", async (t) => {
  try {
    await symlink(outside, path.join(root, "escape"), "junction");
    await symlink(path.join(root, "2024"), path.join(root, "shortcut"), "junction");
  } catch {
    t.skip("links are not allowed here");
    return;
  }
  await sameAsFullLookup(path.join(root, "escape", "secret.jpg"));
  await sameAsFullLookup(path.join(root, "shortcut", "trip", "b.mp4"));
  const resolve = createBatchResolver(roots);
  await assert.rejects(resolve(path.join(root, "escape", "secret.jpg")), /outside the mounted folders/);
  assert.equal(await resolve(path.join(root, "shortcut", "trip", "b.mp4")), path.join(roots[0], "2024", "trip", "b.mp4"));
});

test("a file link that leaves the library is refused, and one that stays inside is followed", async (t) => {
  try {
    await symlink(path.join(outside, "secret.jpg"), path.join(root, "leak.jpg"), "file");
    await symlink(path.join(root, "a.jpg"), path.join(root, "alias.jpg"), "file");
  } catch {
    t.skip("file links are not allowed here");
    return;
  }
  await sameAsFullLookup(path.join(root, "leak.jpg"));
  await sameAsFullLookup(path.join(root, "alias.jpg"));
  const resolve = createBatchResolver(roots);
  await assert.rejects(resolve(path.join(root, "leak.jpg")), /outside the mounted folders/);
  assert.equal(await resolve(path.join(root, "alias.jpg")), path.join(roots[0], "a.jpg"));
});

test("no mounted folders means nothing resolves", async () => {
  const resolve = createBatchResolver([]);
  await assert.rejects(resolve(path.join(root, "a.jpg")), /No mounted folders/);
});
