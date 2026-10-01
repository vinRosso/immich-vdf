/** IANA zones, UTC first, then the rest in name order. */
export function listTimeZones(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
  const rest = supported.filter((zone) => zone !== "UTC").sort((a, b) => a.localeCompare(b));
  return ["UTC", ...rest];
}

export function formatTimeZone(zone: string): string {
  return zone.replaceAll("_", " ");
}

export function timeZoneMatches(zone: string, query: string): boolean {
  const needle = query.trim().toLowerCase().replaceAll("_", " ");
  if (!needle) return true;
  return formatTimeZone(zone).toLowerCase().includes(needle);
}
