"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatClock } from "@/lib/format";
import type { IgnoredEntry, SectionId } from "@/lib/types";

export function IgnoredScreen() {
  const [entries, setEntries] = useState<{ server: IgnoredEntry[]; immich: IgnoredEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setEntries(await api("/api/ignore"));
  }

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load ignored groups"));
  }, []);

  async function restore(section: SectionId, key: string) {
    setError(null);
    try {
      await api("/api/ignore", { method: "DELETE", body: JSON.stringify({ section, key }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore");
    }
  }

  const empty = entries && entries.server.length === 0 && entries.immich.length === 0;

  return (
    <AppShell>
      <h1 className="font-heading text-4xl">Ignored</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        A group stays hidden while it has the same files. If a later scan adds a file, it shows up again.
      </p>
      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
      {!entries ? <p className="mt-6 text-sm text-muted-foreground">Loading ignored groups…</p> : null}
      {empty ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Nothing is ignored</CardTitle>
            <CardDescription>Groups you dismiss from Server or Immich are listed here until you put them back.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      <div className="mt-6 space-y-6">
        {(["server", "immich"] as const).map((section) =>
          entries && entries[section].length > 0 ? (
            <section key={section} className="space-y-3">
              <h2 className="font-heading text-2xl capitalize">{section}</h2>
              {entries[section].map((entry) => (
                <Card key={entry.key}>
                  <CardHeader>
                    <CardTitle>{entry.labels.join(", ") || entry.groupId}</CardTitle>
                    <CardDescription>Ignored {formatClock(entry.ignoredAt)}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button size="sm" variant="secondary" onClick={() => void restore(section, entry.key)}>
                      Put back
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </section>
          ) : null,
        )}
      </div>
    </AppShell>
  );
}
