export class HttpUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpUrlError";
  }
}

export function assertHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpUrlError("URL must be http or https");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpUrlError("URL must be http or https");
  }
  if (url.username || url.password) {
    throw new HttpUrlError("URL must not include credentials");
  }
  return url;
}

export async function safeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const first = assertHttpUrl(input);
  const response = await fetch(first, { ...init, redirect: "manual" });
  if (response.status < 300 || response.status >= 400) return response;
  const location = response.headers.get("location");
  if (!location) throw new HttpUrlError("Redirect had no location");
  const next = assertHttpUrl(new URL(location, first).toString());
  return fetch(next, { ...init, redirect: "manual" });
}
