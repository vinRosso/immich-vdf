import { mkdir, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { AppError } from "./errors";
import { addTrashFreed, clearTrashAdded, forgetTrashAdded, loadTrashAdded, loadTrashStats, rememberTrashAdded, rememberTrashAddedMany, trashAddedKey } from "./store";
import { ensurePoster } from "./thumbs";
import { containingRoot, isInside, PathJailError, resolveInside } from "./path-jail";
import type { TrashEntry } from "./types";

const TRASH = ".vdf-trash";

async function findTrashedCopy(roots: string[], candidate: string): Promise<string | null> {
  const normalized = path.normalize(candidate);
  for (const mount of roots) {
    let root: string;
    try {
      root = await realpath(mount);
    } catch {
      continue;
    }
    const rel = path.relative(root, normalized);
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
    if (rel === TRASH || rel.startsWith(`${TRASH}${path.sep}`)) continue;
    try {
      return await resolveInside(roots, path.join(root, TRASH, rel));
    } catch {
      // Not in trash on this mount.
    }
  }
  return null;
}

/** Resolve a scan path on a media mount, including files already moved to .vdf-trash. */
export async function resolveMediaFile(roots: string[], candidate: string): Promise<string> {
  try {
    return await resolveInside(roots, candidate);
  } catch (error) {
    if (!(error instanceof PathJailError)) throw error;
    const trashed = await findTrashedCopy(roots, candidate);
    if (trashed) return trashed;
    throw new AppError("That file is no longer on the media mount");
  }
}

export async function moveToTrash(paths: string[]): Promise<number> {
  const roots = loadConfig().mediaRoots;
  let moved = 0;
  for (const candidate of paths) {
    const real = await resolveMediaFile(roots, candidate);
    const root = await containingRoot(roots, real);
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
    await rememberTrashAdded(root, path.relative(trashRoot, target));
    moved += 1;
  }
  return moved;
}

function safeTrashRelative(relative: string): string {
  const normalized = path.normalize(relative);
  if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new AppError("Invalid trash path");
  }
  return normalized;
}

export async function trashItemPath(mount: string, relative: string): Promise<string> {
  const roots = loadConfig().mediaRoots;
  const root = await resolveInside(roots, mount);
  const trashRoot = path.join(root, TRASH);
  const real = await resolveInside(roots, path.join(trashRoot, safeTrashRelative(relative)));
  if (!isInside(trashRoot, real)) throw new AppError("Trash file not found", 404);
  return real;
}

const TRASH_MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
};

function trashMediaType(file: string): string {
  return TRASH_MEDIA_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
}

export async function trashOriginalFile(mount: string, relative: string): Promise<{ file: string; contentType: string }> {
  const file = await trashItemPath(mount, relative);
  return { file, contentType: trashMediaType(file) };
}

export async function trashThumbFile(mount: string, relative: string): Promise<{ file: string; contentType: string }> {
  const file = await trashItemPath(mount, relative);
  const ext = path.extname(file).toLowerCase();
  const imageType = TRASH_MEDIA_TYPES[ext];
  if (imageType?.startsWith("image/")) return { file, contentType: imageType };
  const poster = await ensurePoster(file);
  return { file: poster, contentType: "image/jpeg" };
}

export async function restoreTrashItem(mount: string, relative: string): Promise<void> {
  const roots = loadConfig().mediaRoots;
  const root = await resolveInside(roots, mount);
  const source = await trashItemPath(mount, relative);
  const safeRelative = safeTrashRelative(relative);
  const destination = path.join(root, safeRelative);
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true });
  const resolvedParent = await resolveInside(roots, parent);
  const realRoot = await realpath(root);
  const realTrashRoot = path.join(realRoot, TRASH);
  if (!isInside(realRoot, resolvedParent) || isInside(realTrashRoot, resolvedParent)) {
    throw new PathJailError("Restore path escapes the mount");
  }
  let target = path.join(resolvedParent, path.basename(destination));
  if (!isInside(realRoot, target) || isInside(realTrashRoot, target)) {
    throw new PathJailError("Restore path escapes the mount");
  }
  try {
    await stat(target);
    const suffix = path.extname(target);
    const stem = target.slice(0, target.length - suffix.length);
    target = `${stem}-restored-${Date.now()}${suffix}`;
    if (!isInside(realRoot, target) || isInside(realTrashRoot, target)) {
      throw new PathJailError("Restore path escapes the mount");
    }
  } catch (error) {
    if (error instanceof PathJailError) throw error;
    // Destination is free.
  }
  await rename(source, target);
  await forgetTrashAdded([trashAddedKey(mount, safeRelative)]);
}

export async function restoreAllTrash(): Promise<number> {
  const entries = await listTrash();
  for (const entry of entries) {
    await restoreTrashItem(entry.mount, entry.relative);
  }
  return entries.length;
}

export async function listTrash(): Promise<TrashEntry[]> {
  const entries: TrashEntry[] = [];
  const added = await loadTrashAdded();
  const missing: { mount: string; relative: string; atMs: number }[] = [];
  for (const mount of loadConfig().mediaRoots) {
    let root: string;
    try {
      root = await resolveInside([mount], mount);
    } catch {
      continue;
    }
    const trashRoot = path.join(root, TRASH);
    await walk(trashRoot, root, trashRoot, entries, added, missing);
  }
  if (missing.length > 0) await rememberTrashAddedMany(missing);
  return entries;
}

async function walk(
  dir: string,
  mount: string,
  trashRoot: string,
  entries: TrashEntry[],
  added: Record<string, number>,
  missing: { mount: string; relative: string; atMs: number }[],
): Promise<void> {
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
    if (info.isDirectory()) await walk(real, mount, trashRoot, entries, added, missing);
    else {
      const relative = path.relative(trashRoot, real);
      const key = trashAddedKey(mount, relative);
      const known = added[key];
      const addedAtMs = typeof known === "number" ? known : info.mtimeMs;
      if (typeof known !== "number") missing.push({ mount, relative, atMs: addedAtMs });
      entries.push({
        mount,
        relative,
        sizeBytes: info.size,
        addedAtMs,
      });
    }
  }
}

export async function emptyTrash(): Promise<{ removed: number; freedBytes: number; totalSavedBytes: number }> {
  const listed = await listTrash();
  const freedBytes = listed.reduce((sum, entry) => sum + entry.sizeBytes, 0);
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
  if (listed.length > 0) await clearTrashAdded();
  const stats = freedBytes > 0 || listed.length > 0 ? await addTrashFreed(freedBytes) : await loadTrashStats();
  return { removed: listed.length, freedBytes, totalSavedBytes: stats.bytesFreed };
}
