export type ResultsGroupSortId =
  | "similarity-desc"
  | "similarity-asc"
  | "files-desc"
  | "files-asc"
  | "total-size-desc"
  | "wasted-desc"
  | "largest-desc"
  | "duration-desc";

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
];

type SortableItem = { similarity: number; sizeBytes: number; durationSeconds: number };
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
    sortId === "duration-desc";
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

/** 1 = largest cards, 9 = smallest. Default 5 matches the previous maximum density. */
export function resultsCardGridClass(cardSize: number): string {
  const size = Math.min(9, Math.max(1, Math.round(cardSize)));
  const map: Record<number, string> = {
    1: "grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-2",
    2: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3",
    3: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
    4: "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
    5: "grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
    6: "grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7",
    7: "grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7",
    8: "grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8",
    9: "grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8",
  };
  return map[size];
}
