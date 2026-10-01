"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/components/api";
import { AppShell } from "@/components/app-shell";
import { RestoreGroupButton, ResultGroupCard } from "@/components/group-result-card";
import { GroupCardGridSkeleton } from "@/components/skeletons";
import { Viewer } from "@/components/viewer";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_RESULTS_CARD_SIZE, resultsCardGridClass } from "@/lib/results-sort";
import { sectionLabel } from "@/lib/section-label";
import type { ClientGroup, IgnoredGroupCard, SectionId } from "@/lib/types";

export function IgnoredScreen({ section }: { section: SectionId }) {
  const [cards, setCards] = useState<IgnoredGroupCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const title = sectionLabel(section);
  const resultsHref = `/${section}`;

  const groupsWithData = useMemo(
    () => (cards ?? []).filter((card): card is IgnoredGroupCard & { group: ClientGroup } => card.group !== null),
    [cards],
  );
  const openCard = groupsWithData.find((card) => card.group.groupId === openGroupId);
  const openGroup = openCard?.group ?? null;
  const openIgnoreKey = openCard?.entry.key ?? null;
  const openIndex = openGroup ? groupsWithData.findIndex((card) => card.group.groupId === openGroup.groupId) : -1;

  async function load() {
    const listed = await api<IgnoredGroupCard[]>(`/api/ignore?section=${section}`);
    setCards(listed);
    return listed;
  }

  async function openGroupAfterRefresh(fromIndex: number, groupId: string | null) {
    const listed = await load();
    const withData = listed.filter((card): card is IgnoredGroupCard & { group: ClientGroup } => card.group !== null);
    if (groupId && withData.some((card) => card.group.groupId === groupId)) {
      setOpenGroupId(groupId);
      return;
    }
    if (fromIndex < 0 || withData.length === 0) {
      setOpenGroupId(null);
      return;
    }
    const next = withData[fromIndex] ?? withData[fromIndex - 1];
    setOpenGroupId(next?.group.groupId ?? null);
  }

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load ignored groups"));
  }, [section]);

  async function restore(key: string) {
    setError(null);
    try {
      const fromIndex =
        openGroupId && cards?.some((card) => card.entry.key === key && card.group?.groupId === openGroupId)
          ? openIndex
          : -1;
      await api("/api/ignore", { method: "DELETE", body: JSON.stringify({ section, key }) });
      await openGroupAfterRefresh(fromIndex, openGroupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore");
    }
  }

  return (
    <AppShell>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="size-9 shrink-0 rounded-full">
          <a href={resultsHref} aria-label={`Back to ${title} results`}>
            <ArrowLeft className="size-5" />
          </a>
        </Button>
        <h1 className="font-heading text-4xl">{title} ignored</h1>
      </div>
      <p className="mt-2 text-sm whitespace-nowrap text-muted-foreground">
        {title} groups stay hidden while they have the same files. If a later scan adds a file, the group shows up again.
      </p>
      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
      {!cards ? (
        <div className="mt-6">
          <GroupCardGridSkeleton count={6} />
        </div>
      ) : null}
      {cards && cards.length === 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Nothing is ignored</CardTitle>
            <CardDescription>Groups you dismiss from {title} are listed here until you restore them.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      {cards && cards.length > 0 ? (
        <div className={resultsCardGridClass(DEFAULT_RESULTS_CARD_SIZE) + " mt-6"}>
          {cards.map((card) =>
            card.group ? (
              <ResultGroupCard
                key={card.entry.key}
                section={section}
                group={card.group}
                onSelect={() => setOpenGroupId(card.group!.groupId)}
                topRight={<RestoreGroupButton onClick={() => void restore(card.entry.key)} />}
              />
            ) : (
              <Card key={card.entry.key} className="flex flex-col justify-between p-4">
                <div>
                  <p className="font-medium">{card.entry.labels.join(", ") || card.entry.groupId}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Group no longer in scan results</p>
                </div>
                <RestoreGroupButton onClick={() => void restore(card.entry.key)} />
              </Card>
            ),
          )}
        </div>
      ) : null}
      <Viewer
        section={section}
        group={openGroup}
        index={openIndex}
        total={groupsWithData.length}
        onPrev={() => {
          const previous = groupsWithData[openIndex - 1];
          if (previous) setOpenGroupId(previous.group.groupId);
        }}
        onNext={() => {
          const next = groupsWithData[openIndex + 1];
          if (next) setOpenGroupId(next.group.groupId);
        }}
        onClose={() => setOpenGroupId(null)}
        onActionDone={() => openGroupAfterRefresh(openIndex, openGroupId)}
        ignoredKey={openIgnoreKey}
      />
    </AppShell>
  );
}
