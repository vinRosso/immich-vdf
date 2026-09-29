/** Build `/login?next=…` for an in-app path (pathname + search). */
export function loginUrlForPath(pathname: string, search = ""): string {
  const target = `${pathname || "/"}${search || ""}`;
  if (target === "/login" || target.startsWith("/login?")) return "/login";
  return `/login?next=${encodeURIComponent(target)}`;
}

/** Only allow same-origin relative paths after sign-in. */
export function safeLoginNext(next: string | null | undefined): string | null {
  if (!next) return null;
  const value = next.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value === "/login" || value.startsWith("/login?")) return null;
  return value;
}
