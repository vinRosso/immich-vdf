import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { resolveImmichScanRoots } from "./immich-mounts";
import { isInside, resolveInside } from "./path-jail";
import { loadSettings } from "./store";
import type { SectionId } from "./types";

export type FolderEntry = { name: string; path: string };

export type FolderListing = {
  current: string | null;
  parent: string | null;
  dirs: FolderEntry[];
};

export async function scanRootsForSection(section: SectionId): Promise<string[]> {
  if (section === "server") return loadConfig().mediaRoots;
  const settings = await loadSettings();
  return resolveImmichScanRoots({ baseUrl: settings.immich.baseUrl, apiKey: settings.immich.apiKey });
}

export async function listFolders(section: SectionId, folder: string | null): Promise<FolderListing> {
  const roots = await scanRootsForSection(section);
  const realRoots = await existingRoots(roots);
  if (!folder) {
    return {
      current: null,
      parent: null,
      dirs: realRoots.map((root) => ({ name: path.basename(root) || root, path: root })),
    };
  }
  const current = await resolveInside(realRoots, folder);
  const parent = realRoots.some((root) => root === current) ? null : path.dirname(current);
  return { current, parent, dirs: await childDirs(current, realRoots) };
}

async function existingRoots(roots: string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const root of roots) {
    try {
      resolved.push(await realpath(root));
    } catch {
      // A missing mount is omitted from the picker.
    }
  }
  return resolved;
}

async function childDirs(dir: string, roots: string[]): Promise<FolderEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const dirs: FolderEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    let real: string;
    try {
      real = await realpath(full);
      if (!(await stat(real)).isDirectory()) continue;
    } catch {
      continue;
    }
    if (!roots.some((root) => isInside(root, real))) continue;
    dirs.push({ name: entry.name, path: real });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  return dirs;
}
