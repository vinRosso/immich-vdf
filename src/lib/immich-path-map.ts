import { readdirSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { loadConfig } from "./config";
import {
  externalRootsFromScanRoots,
  immichMediaPrefix,
  immichScanRootsFromConfig,
  immichUploadMount,
  resolveImmichScanRoots,
  type ImmichCredentials,
} from "./immich-mounts";
import type { PathMapEntry } from "./types";

async function resolvedMount(mount: string): Promise<string> {
  try {
    return await realpath(mount);
  } catch {
    return mount;
  }
}

function mountChildren(mount: string): string[] {
  try {
    return readdirSync(mount, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Map Immich `originalPath` prefixes to scan paths inside vdf-web. */
export async function resolveImmichPathMap(credentials?: ImmichCredentials): Promise<PathMapEntry[]> {
  const config = loadConfig();
  const scanRoots = await resolveImmichScanRoots(credentials);
  const uploadMount = await resolvedMount(immichUploadMount(config));
  const maps: PathMapEntry[] = [{ from: immichMediaPrefix(mountChildren(uploadMount)), to: uploadMount }];
  for (const mount of externalRootsFromScanRoots(scanRoots, config)) {
    maps.push({ from: mount, to: await resolvedMount(mount) });
  }
  return maps;
}

export function resolveImmichPathMapSync(): PathMapEntry[] {
  const config = loadConfig();
  const scanRoots = immichScanRootsFromConfig(config);
  const uploadMount = immichUploadMount(config);
  const maps: PathMapEntry[] = [{ from: immichMediaPrefix(mountChildren(uploadMount)), to: uploadMount }];
  for (const mount of externalRootsFromScanRoots(scanRoots, config)) {
    maps.push({ from: mount, to: mount });
  }
  return maps;
}
