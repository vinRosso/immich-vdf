"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "cn";

const links = [
  { href: "/server", label: "Server" },
  { href: "/immich", label: "Immich" },
  { href: "/ignored", label: "Ignored" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-16 pt-5 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="text-xs tracking-[0.22em] text-primary uppercase">Video Duplicate Finder</p>
          <Link href="/server" className="font-heading text-3xl leading-none">
            VDF
          </Link>
        </div>
        <nav className="flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm",
                pathname === link.href ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {link.label}
            </Link>
          ))}
          <button type="button" onClick={() => void logout()} className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            Sign out
          </button>
        </nav>
      </header>
      {children}
    </div>
  );
}
