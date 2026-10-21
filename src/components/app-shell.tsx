"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "cn";
import { api } from "@/components/api";
import { UndoToast } from "@/components/undo-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sectionLabel } from "@/lib/section-label";
import type { RuntimeInfo, SectionId } from "@/lib/types";

const links = [
  { href: "/", label: "Home" },
  { href: "/immich", label: sectionLabel("immich") },
  { href: "/server", label: sectionLabel("server") },
];

/** `wide` lets the page use the full window width and own its scrolling (the library pages). */
export function AppShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<RuntimeInfo>("/api/runtime")
      .then((next) => {
        if (!cancelled) setRuntime(next);
      })
      .catch(() => {
        if (!cancelled) setRuntime(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <header
        className={cn(
          "sticky top-0 z-30 w-full border-b border-white/[0.06] bg-background/75 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.5)] backdrop-blur-xl",
          !wide && "mb-4",
        )}
      >
        <div
          className={cn(
            "mx-auto flex w-full flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-4",
            wide ? "max-w-none" : "max-w-7xl",
          )}
        >
          <div className="flex items-center justify-between gap-3 md:min-w-0 md:flex-1 md:justify-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/"
                      className="block font-heading text-3xl leading-none text-foreground transition-colors hover:text-foreground/90"
                    >
                      immich-vdf
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" className="space-y-1 text-xs">
                    <p>vdf-cli {runtime?.cliVersion ?? (runtime ? "not found" : "…")}</p>
                    <p>Native FFmpeg: {nativeFfmpegLabel(runtime)}</p>
                  </TooltipContent>
                </Tooltip>
                {runtime && !runtime.cliAvailable ? (
                  <p className="text-sm text-destructive">Scanning isn&apos;t available right now. You can still review saved results.</p>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="shrink-0 rounded-full px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground md:hidden"
            >
              Sign out
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:ml-auto md:flex-nowrap md:justify-end">
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
              className="hidden shrink-0 rounded-full px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground md:inline-flex"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col",
          wide
            ? "overflow-hidden"
            : "scrollbar-subtle mx-auto max-w-7xl overflow-auto px-4 pb-4 sm:px-6",
        )}
      >
        {children}
      </div>
      <UndoToast />
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

function nativeFfmpegLabel(runtime: RuntimeInfo | null): string {
  if (!runtime) return "…";
  if (runtime.nativeFfmpeg.mode === "off") return "off";
  if (runtime.nativeFfmpeg.available === null) return "not checked";
  if (runtime.nativeFfmpeg.available) return "loaded";
  return runtime.nativeFfmpeg.mode === "on" ? "libraries missing" : "not installed, downloads on next scan";
}
