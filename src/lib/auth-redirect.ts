/** Build `/login?next=…` for an in-app path (pathname + search). */
export function loginUrlForPath(pathname: string, search = ""): string {
  const target = `${pathname || "/"}${search || ""}`;
  if (target === "/login" || target.startsWith("/login?")) return "/login";
  return `/login?next=${encodeURIComponent(target)}`;
}

function unsafePath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return true;
  if (value.includes("\\") || value.includes("\0") || /[\r\n\t]/.test(value)) return true;
  const slashes = value.replace(/\\/g, "/");
  return /^\/\s*\/\s*/.test(slashes);
}

/** Only allow same-origin relative paths after sign-in. */
export function safeLoginNext(next: string | null | undefined): string | null {
  if (!next) return null;
  const raw = next.trim();
  if (unsafePath(raw)) return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (unsafePath(value)) return null;
  if (value === "/login" || value.startsWith("/login?") || value.startsWith("/login#")) return null;
  return value;
}
