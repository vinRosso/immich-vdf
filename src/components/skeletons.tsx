import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_RESULTS_CARD_SIZE, resultsCardGridClass } from "@/lib/results-sort";
import { cn } from "cn";

/** Fades freshly loaded content in, a beat later for each later `index`, so a page fills in piece by piece. */
export function Reveal({
  index = 0,
  className,
  children,
}: {
  index?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "animate-in fade-in-0 slide-in-from-bottom-1 duration-300 fill-mode-backwards motion-reduce:slide-in-from-bottom-0",
        className,
      )}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      {children}
    </div>
  );
}

export function SkeletonText({ className }: { className?: string }) {
  return <Skeleton className={cn("h-3", className)} />;
}

export function GroupResultCardSkeleton({ index = 0 }: { index?: number }) {
  return (
    <div className="overflow-hidden rounded-xl bg-black ring-1 ring-foreground/10">
      <Skeleton index={index} className="aspect-[4/3] w-full rounded-none" />
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <Skeleton index={index} className="h-3 w-12" />
        <Skeleton index={index} className="h-3 w-16" />
      </div>
    </div>
  );
}

export function GroupCardGridSkeleton({ count = 8, cardSize = DEFAULT_RESULTS_CARD_SIZE }: { count?: number; cardSize?: number }) {
  return (
    <div className={resultsCardGridClass(cardSize)} aria-busy="true" aria-label="Loading groups">
      {Array.from({ length: count }, (_, index) => (
        <GroupResultCardSkeleton key={index} index={index} />
      ))}
    </div>
  );
}

export function HomeGroupGridSkeleton() {
  return (
    <div className="grid w-full grid-cols-5 gap-1.5" aria-busy="true" aria-label="Loading groups">
      {Array.from({ length: 10 }, (_, index) => (
        <Skeleton key={index} index={index} className="aspect-square w-full rounded-md" />
      ))}
    </div>
  );
}

export function ImmichConnectionSkeleton() {
  return (
    <div className="flex h-7 min-w-0 items-center gap-2" aria-busy="true" aria-label="Checking connection">
      <Skeleton index={0} className="size-3.5 rounded-full" />
      <Skeleton index={1} className="h-3 w-24" />
      <Skeleton index={2} className="h-3 w-40 max-w-[12rem]" />
    </div>
  );
}

export function UnmatchedScreenSkeleton() {
  return (
    <div className="mt-6 space-y-8" aria-busy="true" aria-label="Loading unmatched files">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <Skeleton index={0} className="h-7 w-28" />
            <Skeleton index={1} className="h-3 w-full max-w-xl" />
            <Skeleton index={2} className="h-3 w-full max-w-lg" />
          </div>
          <Skeleton index={1} className="h-8 w-28" />
        </div>
        <div className="overflow-hidden rounded-xl border border-border p-3 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-24" />
          </div>
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="grid grid-cols-2 gap-3 border-t border-border pt-2">
              <Skeleton index={index + 2} className="h-4 w-full" />
              <Skeleton index={index + 2} className="h-4 w-full" />
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <Skeleton index={5} className="h-7 w-56" />
        <Skeleton index={6} className="h-3 w-full max-w-2xl" />
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="rounded-xl border border-border p-3">
            <Skeleton index={index + 6} className="h-4 w-full max-w-md" />
          </div>
        ))}
      </section>
    </div>
  );
}

export function TrashListSkeleton() {
  return (
    <div className="mt-4 space-y-3" aria-busy="true" aria-label="Loading trash">
      <div className="flex justify-between">
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-24" />
      </div>
      <ul className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index} className="flex items-center gap-3 rounded-lg border border-border/60 px-2 py-2">
            <Skeleton index={index} className="size-14 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton index={index} className="h-4 w-48 max-w-full" />
              <Skeleton index={index} className="h-3 w-32" />
            </div>
            <Skeleton index={index} className="h-8 w-20" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AlbumTagsSkeleton() {
  return (
    <div className="flex flex-wrap gap-1" aria-busy="true" aria-label="Loading albums">
      <Skeleton index={0} className="h-5 w-20 rounded-full" />
      <Skeleton index={1} className="h-5 w-24 rounded-full" />
    </div>
  );
}

export function ThumbnailSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("absolute inset-0 rounded-none", className)} aria-hidden />;
}

