import { realpath } from "node:fs/promises";
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

export async function resolveInside(roots: string[], candidate: string): Promise<string> {
  if (!candidate || candidate.includes("\0")) throw new PathJailError("Path is empty");
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new PathJailError(`Folder does not exist: ${candidate}`);
  }
  const resolvedRoots: string[] = [];
  for (const root of roots) {
    try {
      resolvedRoots.push(await realpath(root));
    } catch {
      // A configured mount that is not present does not widen the jail.
    }
  }
  if (resolvedRoots.length === 0) throw new PathJailError("No mounted folders are available");
  if (!resolvedRoots.some((root) => isInside(root, resolved))) {
    throw new PathJailError("Path is outside the mounted folders");
  }
  return resolved;
}

export async function containingRoot(roots: string[], candidate: string): Promise<string> {
  const resolved = await resolveInside(roots, candidate);
  for (const root of roots) {
    const realRoot = await realpath(root);
    if (isInside(realRoot, resolved)) return realRoot;
  }
  throw new PathJailError("Path is outside the mounted folders");
}
