export type ResultsGroupSortId =
  | "similarity-desc"
  | "similarity-asc"
  | "files-desc"
  | "files-asc"
  | "total-size-desc"
  | "wasted-desc"
  | "largest-desc"
  | "duration-desc"
  | "time-desc"
  | "time-asc";

export const DEFAULT_RESULTS_GROUP_SORT: ResultsGroupSortId = "similarity-desc";

export const RESULTS_GROUP_SORT_OPTIONS: { id: ResultsGroupSortId; label: string }[] = [
  { id: "similarity-desc", label: "Similarity, highest first" },
  { id: "similarity-asc", label: "Similarity, lowest first" },
  { id: "files-desc", label: "File count, most first" },
  { id: "files-asc", label: "File count, fewest first" },
  { id: "total-size-desc", label: "Total size, largest first" },
  { id: "wasted-desc", label: "Wasted space, most first" },
  { id: "largest-desc", label: "Largest file, biggest first" },
  { id: "duration-desc", label: "Duration, longest first" },
  { id: "time-desc", label: "Date, newest first" },
  { id: "time-asc", label: "Date, oldest first" },
];

type SortableItem = { similarity: number; sizeBytes: number; durationSeconds: number; dateCreatedMs: number };
type GroupLike = { items: SortableItem[] };

function maxSimilarity(group: GroupLike): number {
  return group.items.reduce((max, item) => Math.max(max, item.similarity), 0);
}

function totalSize(group: GroupLike): number {
  return group.items.reduce((sum, item) => sum + item.sizeBytes, 0);
}

function largestFile(group: GroupLike): number {
  return group.items.reduce((max, item) => Math.max(max, item.sizeBytes), 0);
}

function wastedSpace(group: GroupLike): number {
  const total = totalSize(group);
  const keep = largestFile(group);
  return Math.max(0, total - keep);
}

function maxDuration(group: GroupLike): number {
  return group.items.reduce((max, item) => Math.max(max, item.durationSeconds), 0);
}

function newestInGroup(group: GroupLike): number {
  return group.items.reduce((max, item) => Math.max(max, item.dateCreatedMs || 0), 0);
}

export function sortResultGroups<T extends GroupLike>(groups: T[], sortId: ResultsGroupSortId): T[] {
  const score = (group: T): number => {
    switch (sortId) {
      case "similarity-desc":
      case "similarity-asc":
        return maxSimilarity(group);
      case "files-desc":
      case "files-asc":
        return group.items.length;
      case "total-size-desc":
        return totalSize(group);
      case "wasted-desc":
        return wastedSpace(group);
      case "largest-desc":
        return largestFile(group);
      case "duration-desc":
        return maxDuration(group);
      case "time-desc":
      case "time-asc":
        return newestInGroup(group);
      default:
        return 0;
    }
  };
  const descending =
    sortId === "similarity-desc" ||
    sortId === "files-desc" ||
    sortId === "total-size-desc" ||
    sortId === "wasted-desc" ||
    sortId === "largest-desc" ||
    sortId === "duration-desc" ||
    sortId === "time-desc";
  return [...groups].sort((a, b) => {
    const delta = score(b) - score(a);
    return descending ? delta : -delta;
  });
}

export function isResultsGroupSortId(value: string): value is ResultsGroupSortId {
  return RESULTS_GROUP_SORT_OPTIONS.some((option) => option.id === value);
}

export function resultsSortStorageKey(section: string): string {
  return `vdf-results-sort:${section}`;
}

export function resultsCardSizeStorageKey(section: string): string {
  return `vdf-results-card-size:${section}`;
}

export const DEFAULT_RESULTS_CARD_SIZE = 5;

/** Column counts follow Tailwind's sm/lg/xl breakpoints. Gap is the default 16px root. */
type ResultsGridSpec = {
  className: string;
  base: number;
  sm: number;
  lg: number;
  xl: number;
  gap: number;
};

const RESULTS_GRID_SPECS: Record<number, ResultsGridSpec> = {
  1: { className: "grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-2", base: 1, sm: 1, lg: 2, xl: 2, gap: 16 },
  2: { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3", base: 1, sm: 2, lg: 2, xl: 3, gap: 16 },
  3: { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", base: 1, sm: 2, lg: 3, xl: 4, gap: 16 },
  4: { className: "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5", base: 2, sm: 3, lg: 4, xl: 5, gap: 12 },
  5: { className: "grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6", base: 2, sm: 4, lg: 5, xl: 6, gap: 8 },
  6: { className: "grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7", base: 2, sm: 4, lg: 5, xl: 7, gap: 8 },
  7: { className: "grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7", base: 3, sm: 5, lg: 6, xl: 7, gap: 8 },
  8: { className: "grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8", base: 3, sm: 5, lg: 6, xl: 8, gap: 6 },
  9: { className: "grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8", base: 3, sm: 6, lg: 7, xl: 8, gap: 6 },
};

function resultsGridSpec(cardSize: number): ResultsGridSpec {
  const size = Math.min(9, Math.max(1, Math.round(cardSize)));
  return RESULTS_GRID_SPECS[size] ?? RESULTS_GRID_SPECS[DEFAULT_RESULTS_CARD_SIZE];
}

/** 1 = largest cards, 9 = smallest. Default 5 matches the previous maximum density. */
export function resultsCardGridClass(cardSize: number): string {
  return resultsGridSpec(cardSize).className;
}

/** Columns for the same breakpoints as `resultsCardGridClass`. */
export function resultsGridColumns(cardSize: number, viewportWidth: number): number {
  const spec = resultsGridSpec(cardSize);
  if (viewportWidth >= 1280) return spec.xl;
  if (viewportWidth >= 1024) return spec.lg;
  if (viewportWidth >= 640) return spec.sm;
  return spec.base;
}

export function resultsGridGap(cardSize: number): number {
  return resultsGridSpec(cardSize).gap;
}

/** `endRow` is exclusive. */
export function visibleRowRange(input: {
  scrollTop: number;
  viewportHeight: number;
  gridTop: number;
  rowStride: number;
  rowCount: number;
  overscan: number;
}): { startRow: number; endRow: number } {
  if (input.rowCount <= 0 || input.rowStride <= 0 || input.viewportHeight <= 0) return { startRow: 0, endRow: 0 };
  const viewStart = input.scrollTop - input.gridTop;
  const viewEnd = viewStart + input.viewportHeight;
  let start = Math.floor(viewStart / input.rowStride) - input.overscan;
  let end = Math.ceil(viewEnd / input.rowStride) + input.overscan;
  if (start < 0) start = 0;
  if (end > input.rowCount) end = input.rowCount;
  if (end < start) end = start;
  return { startRow: start, endRow: end };
}
