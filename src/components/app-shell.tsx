"use client";

import { Suspense, useEffect, useState } from "react";
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
  const router = useRouter();
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
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <header className="sticky top-0 z-30 mb-4 w-full border-b border-white/[0.06] bg-background/75 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.5)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
              <a
                href="/"
                className="block font-heading text-3xl leading-none text-foreground transition-colors hover:text-foreground/90"
              >
                immich-vdf
              </a>
              {runtime && !runtime.cliAvailable ? (
                <p className="text-sm text-destructive">vdf-cli is not on this machine. You can still set folders and review saved results.</p>
              ) : null}
              {runtime?.cliVersion ? (
                <span className="block font-mono text-sm leading-none text-muted-foreground/80">{runtime.cliVersion}</span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {trashSavedBytes === null ? (
              <Skeleton className="h-8 w-[5.5rem] rounded-full" aria-label="Loading saved space" />
            ) : (
              <a
                href="/trash"
                className="rounded-full border border-white/[0.06] bg-white/[0.02] px-3.5 py-1.5 text-sm text-muted-foreground tabular-nums transition-colors hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-foreground"
                title="Duplicates removed via .vdf-trash (emptied) and Immich trash"
              >
                {formatBytes(trashSavedBytes)} saved
              </a>
            )}
            <Suspense
              fallback={
                <nav className="flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.03] p-1 shadow-inner backdrop-blur-sm">
                  {links.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      className={cn(
                        "rounded-full px-3.5 py-1 text-sm font-medium transition-all duration-150",
                        navActive(pathname, link.href, null, pathname === "/trash")
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
                      )}
                    >
                      {link.label}
                    </a>
                  ))}
                </nav>
              }
            >
              <AppShellNav pathname={pathname} />
            </Suspense>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-full px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div
        className={cn(
          "scrollbar-subtle mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col overflow-auto px-6 pb-4",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function AppShellNav({ pathname }: { pathname: string }) {
  const searchParams = useSearchParams();
  const ignoredSection =
    pathname === "/ignored" ? (searchParams.get("section") === "immich" ? "immich" : "server") : null;
  return (
    <nav className="flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.03] p-1 shadow-inner backdrop-blur-sm">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className={cn(
            "rounded-full px-3.5 py-1 text-sm font-medium transition-all duration-150",
            navActive(pathname, link.href, ignoredSection, pathname === "/trash")
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
          )}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function navActive(pathname: string, href: string, ignoredSection: SectionId | null, trashPage: boolean): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/server") return pathname === "/server" || ignoredSection === "server" || trashPage;
  if (href === "/immich") return pathname === "/immich" || pathname.startsWith("/immich/") || ignoredSection === "immich";
  return pathname === href;
}

