"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { HomeGroupListSkeleton } from "@/components/skeletons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatClock } from "@/lib/format";
import { sectionLabel } from "@/lib/section-label";
import type { ResultsResponse, SectionId } from "@/lib/types";

const LATEST = 6;

export function HomeScreen() {
  const [server, setServer] = useState<ResultsResponse | null>(null);
  const [immich, setImmich] = useState<ResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<ResultsResponse>("/api/results?section=server"),
      api<ResultsResponse>("/api/results?section=immich"),
    ])
      .then(([nextServer, nextImmich]) => {
        if (cancelled) return;
        setServer(nextServer);
        setImmich(nextImmich);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load groups");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-heading text-4xl">Home</h1>
        <div className="flex gap-2">
          <Button asChild variant="secondary">
            <a href="/immich">{sectionLabel("immich")}</a>
          </Button>
          <Button asChild>
            <a href="/server">{sectionLabel("server")}</a>
          </Button>
        </div>
      </div>
      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <LatestGroups section="server" results={server} />
        <LatestGroups section="immich" results={immich} />
      </div>
    </AppShell>
  );
}

function LatestGroups({ section, results }: { section: SectionId; results: ResultsResponse | null }) {
  const title = sectionLabel(section);
  const groups = results?.groups.slice(0, LATEST) ?? [];
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-2xl">{title}</h2>
      {!results ? <HomeGroupListSkeleton /> : null}
      {results && !results.scanned ? <p className="text-sm text-muted-foreground">No scan yet.</p> : null}
      {results?.scanned && groups.length === 0 ? <p className="text-sm text-muted-foreground">No groups in the latest scan.</p> : null}
      {groups.map((group) => (
        <Card key={group.groupId}>
          <CardHeader>
            <CardTitle>{group.items.length} files</CardTitle>
            <CardDescription>{group.items.map((item) => item.name).join(", ")}</CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {results?.finishedAt ? `Finished ${formatClock(results.finishedAt)}` : group.groupId}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
