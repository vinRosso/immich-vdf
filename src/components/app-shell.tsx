"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "cn";
import { api } from "@/components/api";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/format";
import { TRASH_SAVED_EVENT } from "@/lib/trash-events";
import { sectionLabel } from "@/lib/section-label";
import type { RuntimeInfo, SectionId } from "@/lib/types";

const links = [
  { href: "/", label: "Home" },
  { href: "/immich", label: sectionLabel("immich") },
  { href: "/server", label: sectionLabel("server") },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const ignoredSection =
    pathname === "/ignored" ? (searchParams.get("section") === "immich" ? "immich" : "server") : null;
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
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
              <a href="/" className="font-heading text-3xl leading-none">
                VDF
              </a>
              {runtime && !runtime.cliAvailable ? (
                <p className="text-sm text-destructive">vdf-cli is not on this machine. You can still set folders and review saved results.</p>
              ) : null}
              {runtime?.cliVersion ? <span className="font-mono text-sm text-foreground/80">{runtime.cliVersion}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {trashSavedBytes === null ? (
              <Skeleton className="h-8 w-[5.5rem] rounded-full" aria-label="Loading saved space" />
            ) : (
              <a
                href="/trash"
                className="rounded-full px-3 py-1.5 text-sm text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground"
                title="Disk space freed after permanently emptying .vdf-trash"
              >
                {formatBytes(trashSavedBytes)} saved
              </a>
            )}
            <nav className="flex items-center gap-0.5 rounded-full bg-muted p-1">
              {links.map((link) => (
                <a
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
                </a>
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
  if (href === "/immich") return pathname === "/immich" || pathname.startsWith("/immich/") || ignoredSection === "immich";
  return pathname === href;
}

