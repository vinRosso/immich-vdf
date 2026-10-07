export type WorkerImage = {
  path: string;
  dateCreatedMs: number;
  sizeBytes: number;
  fileName?: string | null;
};

export function clustersFromLists(lists: WorkerImage[][], windowMs: number, windowDays?: number): string[][];
export function filterInScope<T extends { path: string }>(images: readonly T[], includes: readonly string[], excludes: readonly string[]): T[];
