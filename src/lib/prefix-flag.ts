/** Stored on items that joined a group because of the file-name prefix, not a visual match. */
export const PREFIX_FLAG = "Prefix";

/** Label shown for prefix groups and for the Prefix flag. */
export const BURST_LABEL = "Burst";

export function flagLabel(flag: string): string {
  return flag === PREFIX_FLAG ? BURST_LABEL : flag;
}
