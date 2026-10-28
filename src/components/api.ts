import { loginUrlForPath } from "@/lib/auth-redirect";

async function send(url: string, init?: RequestInit): Promise<{ response: Response; text: string }> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  return { response, text: await response.text() };
}

function parse(text: string): { error?: string } | null {
  if (!text) return {};
  try {
    return JSON.parse(text) as { error?: string };
  } catch {
    return null;
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let { response, text } = await send(url, init);
  let body = parse(text);
  // A body cut off by a proxy or a dropped connection is read again once. Only reads: a mutation may have run.
  const method = (init?.method ?? "GET").toUpperCase();
  if (body === null && response.status !== 401 && method === "GET") {
    ({ response, text } = await send(url, init));
    body = parse(text);
  }
  if (response.status === 401) {
    if (typeof window !== "undefined") {
      window.location.assign(loginUrlForPath(window.location.pathname, window.location.search));
    }
    throw new Error("Sign in required");
  }
  if (body === null) {
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    throw new Error(`Response cut off after ${new Blob([text]).size} bytes`);
  }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}
