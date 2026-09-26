import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { containingRoot, isInside, PathJailError, resolveInside } from "./path-jail";
import type { TrashEntry } from "./types";

const TRASH = ".vdf-trash";

export async function moveToTrash(paths: string[]): Promise<number> {
  const roots = loadConfig().mediaRoots;
  let moved = 0;
  for (const candidate of paths) {
    const root = await containingRoot(roots, candidate);
    const real = await resolveInside(roots, candidate);
    const relative = path.relative(root, real);
    if (relative === TRASH || relative.startsWith(`${TRASH}${path.sep}`)) continue;
    const destination = path.join(root, TRASH, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    const parent = await resolveInside(roots, path.dirname(destination));
    const trashRoot = path.join(root, TRASH);
    if (parent !== trashRoot && !isInside(trashRoot, parent)) {
      throw new PathJailError("Trash folder escapes the mount");
    }
    let target = destination;
    try {
      await stat(destination);
      const suffix = path.extname(destination);
      const stem = destination.slice(0, destination.length - suffix.length);
      target = `${stem}-${Date.now()}${suffix}`;
    } catch {
      // Destination is free.
    }
    await rename(real, target);
    moved += 1;
  }
  return moved;
}

export async function listTrash(): Promise<TrashEntry[]> {
  const entries: TrashEntry[] = [];
  for (const mount of loadConfig().mediaRoots) {
    let root: string;
    try {
      root = await resolveInside([mount], mount);
    } catch {
      continue;
    }
    const trashRoot = path.join(root, TRASH);
    await walk(trashRoot, root, trashRoot, entries);
  }
  return entries;
}

async function walk(dir: string, mount: string, trashRoot: string, entries: TrashEntry[]): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    let real: string;
    try {
      real = await resolveInside([mount], full);
    } catch {
      continue;
    }
    if (!isInside(trashRoot, real)) continue;
    const info = await stat(real);
    if (info.isDirectory()) await walk(real, mount, trashRoot, entries);
    else {
      entries.push({
        mount,
        relative: path.relative(trashRoot, real),
        sizeBytes: info.size,
      });
    }
  }
}

export async function emptyTrash(): Promise<number> {
  const listed = await listTrash();
  for (const mount of loadConfig().mediaRoots) {
    let root: string;
    try {
      root = await resolveInside([mount], mount);
    } catch {
      continue;
    }
    const trashRoot = path.join(root, TRASH);
    try {
      const real = await resolveInside([mount], trashRoot);
      if (!isInside(root, real)) continue;
      await rm(real, { recursive: true, force: true });
    } catch {
      // Nothing to remove.
    }
  }
  return listed.length;
}
