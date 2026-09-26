export function redact(text: string, secrets: string[]): string {
  let out = text;
  const unique = [...new Set(secrets.map((secret) => secret.trim()).filter((secret) => secret.length >= 6))];
  unique.sort((a, b) => b.length - a.length);
  for (const secret of unique) {
    out = out.split(secret).join("[redacted]");
  }
  return out;
}
