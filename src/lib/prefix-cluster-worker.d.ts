export type WorkerImage = {
  path: string;
  dateCreatedMs: number;
  sizeBytes: number;
  fileName?: string | null;
};

export function clustersFromLists(lists: WorkerImage[][], windowMs: number, windowDays?: number): string[][];

export type ScopePath = {
  sep: string;
  normalize(filePath: string): string;
  parse(filePath: string): { root: string };
};

export function coveredBy(root: string, target: string, pathImpl?: ScopePath): boolean;
export function filterInScope<T extends { path: string }>(
  images: readonly T[],
  includes: readonly string[],
  excludes: readonly string[],
  pathImpl?: ScopePath,
): T[];
