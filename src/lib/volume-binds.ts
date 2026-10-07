import path from "node:path";
import type { AppConfig } from "./config";

export type VolumeBind = {
  /** Path as Immich or immich-vdf sees it (`/data/...`, `/immich/...`). */
  mount: string;
  /** Host folder with the real files (dev: UNC or drive letter). */
  host: string;
};

function normalizeMount(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function joinHostSuffix(hostRoot: string, suffix: string): string {
  const parts = suffix.split("/").filter(Boolean);
  const joiner = hostRoot.includes("\\") ? path.win32 : path.posix;
  return parts.reduce((current, part) => joiner.join(current, part), hostRoot);
}

/** Parse `VOLUME_BINDS`: `mount=host` entries, comma- or semicolon-separated. Optional `:ro` suffix (ignored). */
export function parseVolumeBinds(raw: string | undefined): VolumeBind[] {
  const text = raw?.trim();
  if (!text) return [];
  const binds: VolumeBind[] = [];
  for (const entry of text.split(/[,;]+/)) {
    const piece = entry.trim();
    if (!piece) continue;
    const withoutRo = piece.replace(/:ro$/i, "").trim();
    const eq = withoutRo.indexOf("=");
    if (eq > 0) {
      const mount = normalizeMount(withoutRo.slice(0, eq).trim());
      const host = withoutRo.slice(eq + 1).trim();
      if (mount && host) binds.push({ mount, host });
      continue;
    }
    const colon = withoutRo.indexOf(":");
    if (colon > 0) {
      const left = withoutRo.slice(0, colon).trim();
      const right = withoutRo.slice(colon + 1).trim();
      if (!left || !right) continue;
      if (left.startsWith("/")) {
        binds.push({ mount: normalizeMount(left), host: right });
      } else {
        binds.push({ mount: normalizeMount(right), host: left });
      }
    }
  }
  return binds.sort((a, b) => b.mount.length - a.mount.length);
}

function bindsSorted(config: AppConfig): VolumeBind[] {
  return [...config.volumeBinds].sort((a, b) => b.mount.length - a.mount.length);
}

/** Map an Immich container import path to a host path when a bind matches. */
export function hostPathForContainerMount(containerPath: string, config: AppConfig): string | null {
  const normalized = normalizeMount(containerPath);
  const lower = normalized.toLowerCase();
  for (const bind of bindsSorted(config)) {
    const mount = bind.mount;
    const mountLower = mount.toLowerCase();
    if (lower === mountLower) return bind.host;
    if (lower.startsWith(`${mountLower}/`)) {
      const suffix = normalized.slice(mount.length).replace(/^\//, "");
      return joinHostSuffix(bind.host, suffix);
    }
  }
  return null;
}

