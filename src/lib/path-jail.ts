import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export class PathJailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathJailError";
  }
}

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Resolve mount roots once so a batch of files does not stat each root again. */
export async function resolveRoots(roots: string[]): Promise<string[]> {
  const resolvedRoots: string[] = [];
  for (const root of roots) {
    try {
      resolvedRoots.push(await realpath(root));
    } catch {
      // A configured mount that is not present does not widen the jail.
    }
  }
  return resolvedRoots;
}

export async function resolveAgainstRoots(resolvedRoots: string[], candidate: string): Promise<string> {
  if (!candidate || candidate.includes("\0")) throw new PathJailError("Path is empty");
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new PathJailError(`Folder does not exist: ${candidate}`);
  }
  if (resolvedRoots.length === 0) throw new PathJailError("No mounted folders are available");
  if (!resolvedRoots.some((root) => isInside(root, resolved))) {
    throw new PathJailError("Path is outside the mounted folders");
  }
  return resolved;
}

/**
 * `resolveAgainstRoots` for many files. Over a network share each `realpath` walks every folder of the path with a
 * round trip, so the folder of each file is resolved once and kept, and the file itself costs one `lstat`.
 * A file that is a symlink, or a path that is not already in normal form, still gets the full `realpath`, so the
 * answer and the jail check are the same as for `resolveAgainstRoots`.
 */
export function createBatchResolver(resolvedRoots: string[]): (candidate: string) => Promise<string> {
  const folders = new Map<string, Promise<string | null>>();
  const realFolder = (folder: string): Promise<string | null> => {
    let known = folders.get(folder);
    if (!known) {
      known = realpath(folder).catch(() => null);
      folders.set(folder, known);
    }
    return known;
  };

  return async (candidate: string): Promise<string> => {
    if (!candidate || candidate.includes("\0")) throw new PathJailError("Path is empty");
    let resolved: string | null = null;
    const base = path.basename(candidate);
    if (path.normalize(candidate) === candidate && base !== "" && base !== "." && base !== "..") {
      const folder = await realFolder(path.dirname(candidate));
      if (folder !== null) {
        const joined = path.join(folder, base);
        try {
          if (!(await lstat(joined)).isSymbolicLink()) resolved = joined;
        } catch {
          // Missing or unreadable: the full lookup below reports it the same way as before.
        }
      }
    }
    if (resolved === null) {
      try {
        resolved = await realpath(candidate);
      } catch {
        throw new PathJailError(`Folder does not exist: ${candidate}`);
      }
    }
    if (resolvedRoots.length === 0) throw new PathJailError("No mounted folders are available");
    if (!resolvedRoots.some((root) => isInside(root, resolved as string))) {
      throw new PathJailError("Path is outside the mounted folders");
    }
    return resolved;
  };
}

export async function resolveInside(roots: string[], candidate: string): Promise<string> {
  return resolveAgainstRoots(await resolveRoots(roots), candidate);
}

export async function containingRoot(roots: string[], candidate: string): Promise<string> {
  const resolved = await resolveInside(roots, candidate);
  for (const root of roots) {
    const realRoot = await realpath(root);
    if (isInside(realRoot, resolved)) return realRoot;
  }
  throw new PathJailError("Path is outside the mounted folders");
}
