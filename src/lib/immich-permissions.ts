/** Permissions immich-vdf needs from the Immich API key (docs/immich.md, "API key permissions"). */
export const NEEDED_IMMICH_PERMISSIONS = [
  "user.read",
  "asset.read",
  "asset.view",
  "asset.delete",
  "stack.read",
  "stack.create",
  "stack.update",
] as const;

/** Permissions behind optional features; without them the feature is switched off. */
export const OPTIONAL_IMMICH_PERMISSIONS = [
  "asset.statistics",
  "asset.download",
  "album.read",
  "albumAsset.create",
  "albumAsset.delete",
  "library.read",
] as const;

/** `known: false` when Immich could not report them (an older Immich): everything counts as granted. */
export type KeyPermissions = { known: boolean; granted: ReadonlySet<string> };

export const UNKNOWN_KEY_PERMISSIONS: KeyPermissions = { known: false, granted: new Set() };

export function keyHas(perms: KeyPermissions, permission: string): boolean {
  return !perms.known || perms.granted.has("all") || perms.granted.has(permission);
}

export function missingNeeded(perms: KeyPermissions): string[] {
  return NEEDED_IMMICH_PERMISSIONS.filter((permission) => !keyHas(perms, permission));
}

export function missingPermissionMessage(permissions: string[]): string {
  const them = permissions.length === 1 ? "it" : "them";
  return `The Immich API key is missing: ${permissions.join(", ")}. Add ${them} in Immich under Account Settings → API Keys.`;
}

/** `Missing required permission: asset.delete` (Immich's 403 message) → `asset.delete`. */
export function missingPermissionFromMessage(message: unknown): string | null {
  if (typeof message !== "string") return null;
  return /^Missing required permission: ([A-Za-z.]+)$/.exec(message.trim())?.[1] ?? null;
}
