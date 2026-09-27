"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "cn";
import { api } from "@/components/api";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import { TRASH_SAVED_EVENT } from "@/lib/trash-events";
import type { RuntimeInfo, SectionId } from "@/lib/types";

const links = [
  { href: "/", label: "Home" },
  { href: "/server", label: "Server" },
  { href: "/immich", label: "Immich" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const ignoredSection =
    pathname === "/ignored" ? (searchParams.get("section") === "immich" ? "immich" : "server") : null;
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [cliError, setCliError] = useState<string | null>(null);
  const [trashSavedBytes, setTrashSavedBytes] = useState<number | null>(null);

  function loadTrashSaved() {
    return api<{ savedBytes: number }>("/api/trash?summary=1")
      .then((summary) => setTrashSavedBytes(summary.savedBytes))
      .catch(() => setTrashSavedBytes(null));
  }

  function loadRuntime() {
    return api<RuntimeInfo>("/api/runtime")
      .then((next) => {
        setRuntime(next);
        setCliError(null);
      })
      .catch(() => {
        setRuntime(null);
      });
  }

  useEffect(() => {
    let cancelled = false;
    api<RuntimeInfo>("/api/runtime")
      .then((next) => {
        if (!cancelled) setRuntime(next);
      })
      .catch(() => {
        if (!cancelled) setRuntime(null);
      });
    void loadTrashSaved();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadTrashSaved();
  }, [pathname]);

  useEffect(() => {
    function refresh() {
      void loadTrashSaved();
    }
    function onSaved(event: Event) {
      const bytes = (event as CustomEvent<number>).detail;
      if (typeof bytes === "number" && Number.isFinite(bytes)) setTrashSavedBytes(bytes);
      else void loadTrashSaved();
    }
    window.addEventListener("focus", refresh);
    window.addEventListener(TRASH_SAVED_EVENT, onSaved);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(TRASH_SAVED_EVENT, onSaved);
    };
  }, []);

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden px-4 pb-4">
      <header className="sticky top-0 z-30 -mx-4 mb-4 border-b border-border bg-background/85 px-4 py-3 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] tracking-[0.22em] text-primary uppercase">Video Duplicate Finder</p>
            <div className="mt-0.5 flex flex-wrap items-end gap-x-3 gap-y-1">
              <Link href="/" className="font-heading text-3xl leading-none">
                VDF
              </Link>
              {runtime && !runtime.cliAvailable ? (
                <p className="text-sm text-destructive">vdf-cli is not on this machine. You can still set folders and review saved results.</p>
              ) : null}
              {runtime?.cliVersion ? <CliRelease runtime={runtime} error={cliError} onError={setCliError} onUpdated={() => void loadRuntime()} /> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {trashSavedBytes !== null ? (
              <Link
                href="/trash"
                className="rounded-full px-3 py-1.5 text-sm text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground"
                title="Disk space freed after permanently emptying .vdf-trash"
              >
                {formatBytes(trashSavedBytes)} saved
              </Link>
            ) : null}
            <nav className="flex items-center gap-0.5 rounded-full bg-muted p-1">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-sm",
                    navActive(pathname, link.href, ignoredSection, pathname === "/trash")
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <button type="button" onClick={() => void logout()} className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
    </div>
  );
}

function navActive(pathname: string, href: string, ignoredSection: SectionId | null, trashPage: boolean): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/server") return pathname === "/server" || ignoredSection === "server" || trashPage;
  if (href === "/immich") return pathname === "/immich" || ignoredSection === "immich";
  return pathname === href;
}

function CliRelease({
  runtime,
  error,
  onError,
  onUpdated,
}: {
  runtime: RuntimeInfo;
  error: string | null;
  onError: (error: string | null) => void;
  onUpdated: () => void;
}) {
  const [pending, setPending] = useState(false);

  async function update() {
    setPending(true);
    onError(null);
    try {
      await api("/api/cli/update", { method: "POST" });
      onUpdated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not update vdf-cli");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-mono text-foreground/80">{runtime.cliVersion}</span>
      {runtime.updateAvailable && runtime.latestVersion ? (
        <>
          <span className="text-amber-300">{runtime.latestVersion} available</span>
          <Button size="sm" disabled={pending} onClick={() => void update()}>
            {pending ? "Updating…" : "Update"}
          </Button>
        </>
      ) : runtime.latestVersion ? (
        <span className="text-primary">latest</span>
      ) : (
        <span className="text-amber-300">could not check for a newer release</span>
      )}
      {error ? <span className="text-destructive">{error}</span> : null}
    </div>
  );
}
