import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// A rename cannot cross filesystems (EXDEV). When a drive or share is mounted below the media root, its files are
// trashed into a .vdf-trash at the top of that mount instead of the one at the media root.

test("a file on the media root's own filesystem is trashed at the root", async () => {
  const { trashBaseFor } = await import("../src/lib/trash");
  const root = path.join(path.sep, "media");
  const file = path.join(root, "a", "b", "clip.mkv");
  assert.equal(await trashBaseFor(root, file, async () => 1), root);
});

test("a file on a filesystem mounted below the root is trashed at the top of that mount", async () => {
  const { trashBaseFor } = await import("../src/lib/trash");
  const root = path.join(path.sep, "media");
  const mount = path.join(root, "3_media");
  const file = path.join(mount, "39 Misc", "People", "clip.mkv");
  const devices = (p: string) => (p === root ? 1 : 2);
  assert.equal(await trashBaseFor(root, file, async (p) => devices(p)), mount);
});

test("mount points below a media root are read from mountinfo, with escaped spaces", async () => {
  const { mountPointsFromMountinfo } = await import("../src/lib/trash");
  const text = [
    "22 1 8:1 / / rw,relatime - ext4 /dev/sda1 rw",
    "40 22 0:50 /data /media rw,relatime - ext4 /dev/sdb1 rw",
    "41 40 0:51 / /media/3_media rw,relatime - cifs //nas/media rw",
    "42 40 0:52 / /media/39\\040Misc rw,relatime - nfs nas:/misc rw",
    "",
  ].join("\n");
  assert.deepEqual(mountPointsFromMountinfo(text), ["/", "/media", "/media/3_media", "/media/39 Misc"]);
});

test("a trash folder at a nested mount is listed, found and emptied", async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "vdf-trash-mounts-")));
  const root = path.join(dir, "media");
  const nested = path.join(root, "3_media");
  process.env.DATA_DIR = path.join(dir, "data");
  process.env.MEDIA_ROOTS = root;
  await mkdir(path.join(nested, ".vdf-trash", "People"), { recursive: true });
  await writeFile(path.join(nested, ".vdf-trash", "People", "clip.mkv"), "x");
  await mkdir(path.join(root, ".vdf-trash"), { recursive: true });
  await writeFile(path.join(root, ".vdf-trash", "top.jpg"), "yy");

  const store = await import("../src/lib/store");
  await store.rememberTrashAdded(nested, path.join("People", "clip.mkv"));
  const { emptyTrash, listTrash, resolveMediaFile, trashBases } = await import("../src/lib/trash");

  assert.deepEqual((await trashBases([root])).sort(), [nested, root].sort());
  const listed = await listTrash();
  assert.deepEqual(
    listed.map((entry) => [entry.mount, entry.relative]).sort(),
    [
      [nested, path.join("People", "clip.mkv")],
      [root, "top.jpg"],
    ].sort(),
  );
  assert.equal(
    await resolveMediaFile([root], path.join(nested, "People", "clip.mkv")),
    path.join(nested, ".vdf-trash", "People", "clip.mkv"),
  );

  const emptied = await emptyTrash();
  assert.equal(emptied.removed, 2);
  assert.deepEqual(await readdir(nested), []);
});
