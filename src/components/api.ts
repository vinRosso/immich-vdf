import { loginUrlForPath } from "@/lib/auth-redirect";

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as { error?: string }) : {};
  if (response.status === 401) {
    if (typeof window !== "undefined") {
      window.location.assign(loginUrlForPath(window.location.pathname, window.location.search));
    }
    throw new Error("Sign in required");
  }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}
