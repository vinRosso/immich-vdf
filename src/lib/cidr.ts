function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const trimmed = ip.trim().replace(/^::ffff:/i, "");
  const [network, bitsRaw] = cidr.trim().split("/");
  if (!network || bitsRaw === undefined) return false;
  const bits = Number(bitsRaw);
  const ipInt = ipv4ToInt(trimmed);
  const networkInt = ipv4ToInt(network);
  if (ipInt === null || networkInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (networkInt & mask);
}
