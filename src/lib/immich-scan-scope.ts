import path from "node:path";

/** Folders Immich generates next to originals under UPLOAD_LOCATION. */
export const IMMICH_GENERATED_DIRS = ["thumbs", "encoded-video", "profile", "backups"] as const;

/** Storage-template originals. The per-user folder is the storage label (admin → "admin"), not the display name. */
export const IMMICH_LIBRARY_DIR = "library";

/** Legacy originals, used only when library/<storageLabel> is not present. */
export const IMMICH_LEGACY_UPLOAD_DIR = "upload";

function slash(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function samePath(a: string, b: string): boolean {
  return slash(a).toLowerCase() === slash(b).toLowerCase();
}

function childPath(parent: string, name: string): string {
  const joiner = parent.includes("\\") ? path.win32 : path.posix;
  return joiner.join(parent, name);
}

function matchChild(children: string[], wanted: string | null | undefined): string | null {
  if (!wanted?.trim()) return null;
  const key = wanted.trim().toLowerCase();
  return children.find((name) => name.toLowerCase() === key) ?? null;
}

export function planImmichScanPaths(options: {
  uploadMount: string;
  uploadMountAliases?: string[];
  scanRoots: string[];
  configuredIncludes: string[];
  uploadChildren: string[];
  /** Directory names inside UPLOAD_LOCATION/library. */
  libraryChildren?: string[];
  /** Directory names inside UPLOAD_LOCATION/upload (legacy). */
  legacyUploadChildren?: string[];
  /** Immich storage label. The admin user is "admin", even when the display name is different. */
  storageLabel?: string | null;
  userId?: string | null;
}): { includes: string[]; excludes: string[] } {
  const children = new Set(options.uploadChildren.map((name) => name.toLowerCase()));
  const excludes = IMMICH_GENERATED_DIRS.filter((name) => children.has(name)).map((name) =>
    childPath(options.uploadMount, name),
  );
  const libraryRoot = childPath(options.uploadMount, IMMICH_LIBRARY_DIR);
  const legacyRoot = childPath(options.uploadMount, IMMICH_LEGACY_UPLOAD_DIR);
  const libraryUser =
    matchChild(options.libraryChildren ?? [], options.storageLabel) ?? matchChild(options.libraryChildren ?? [], options.userId);
  const mountIsLibraryFolder = !children.has(IMMICH_LIBRARY_DIR) && !children.has(IMMICH_LEGACY_UPLOAD_DIR);
  const directUser = mountIsLibraryFolder ? matchChild(options.uploadChildren, options.storageLabel) : null;
  const legacyUser = matchChild(options.legacyUploadChildren ?? [], options.userId);
  const userOriginal = libraryUser
    ? childPath(libraryRoot, libraryUser)
    : directUser
      ? childPath(options.uploadMount, directUser)
      : legacyUser
        ? childPath(legacyRoot, legacyUser)
        : children.has(IMMICH_LIBRARY_DIR)
          ? libraryRoot
          : null;
  const uploadAliases = [options.uploadMount, ...(options.uploadMountAliases ?? [])];
  const isUploadMount = (folder: string) => uploadAliases.some((alias) => samePath(folder, alias));
  const base = options.configuredIncludes.length > 0 ? options.configuredIncludes : options.scanRoots;
  const includes: string[] = [];
  for (const folder of base) {
    if (isUploadMount(folder) && userOriginal) includes.push(userOriginal);
    else includes.push(folder);
  }
  const seen = new Set<string>();
  return {
    includes: includes.filter((folder) => {
      const key = slash(folder).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    excludes,
  };
}
