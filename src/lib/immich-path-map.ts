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

function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() === b.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Map Immich `originalPath` prefixes to scan paths inside vdf-web. */
export async function resolveImmichPathMap(credentials?: ImmichCredentials): Promise<PathMapEntry[]> {
  const config = loadConfig();
  const logicalMount = immichUploadMount(config);
  const scanRoots = await resolveImmichScanRoots(credentials);
  const uploadMount = await resolvedMount(logicalMount);
  const prefix = immichMediaPrefix(mountChildren(logicalMount));
  const maps: PathMapEntry[] = [{ from: prefix, to: uploadMount }];
  for (const bind of config.immichBinds) maps.push({ from: bind.containerPath, to: bind.hostPath });
  for (const mount of externalRootsFromScanRoots(scanRoots, config)) {
    if (config.immichBinds.some((bind) => samePath(bind.hostPath, mount))) continue;
    maps.push({ from: mount, to: await resolvedMount(mount) });
  }
  return maps;
}

export function resolveImmichPathMapSync(): PathMapEntry[] {
  const config = loadConfig();
  const scanRoots = immichScanRootsFromConfig(config);
  const uploadMount = immichUploadMount(config);
  const maps: PathMapEntry[] = [{ from: immichMediaPrefix(mountChildren(uploadMount)), to: uploadMount }];
  for (const bind of config.immichBinds) maps.push({ from: bind.containerPath, to: bind.hostPath });
  for (const mount of externalRootsFromScanRoots(scanRoots, config)) {
    if (config.immichBinds.some((bind) => samePath(bind.hostPath, mount))) continue;
    maps.push({ from: mount, to: mount });
  }
  return maps;
}
