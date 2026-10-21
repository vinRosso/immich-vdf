"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { safeLoginNext } from "@/lib/auth-redirect";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const afterLogin = safeLoginNext(searchParams.get("next")) ?? "/";

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/session")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { authed?: boolean } | null) => {
        if (cancelled || !body?.authed) return;
        router.replace(afterLogin);
      })
      .catch(() => {
        // Server not running or network error — stay on the sign-in form.
      });
    return () => {
      cancelled = true;
    };
  }, [afterLogin, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not sign in. Try again.");
      router.replace(afterLogin);
      router.refresh();
    } catch (err) {
      if (err instanceof TypeError) {
        setError("Can't reach the server. Check your connection and try again.");
      } else {
        setError(err instanceof Error ? err.message : "Could not sign in. Try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4">
      <p className="flex items-center gap-2 text-xs tracking-wide text-primary">
        <span aria-hidden className="size-1.5 rounded-full bg-primary" />
        immich-vdf
      </p>
      <h1 className="mt-2 font-heading text-5xl">Sign in</h1>
      <p className="mt-3 text-sm text-muted-foreground">Enter your password to continue.</p>
      <form onSubmit={(event) => void submit(event)} className="mt-8 space-y-4" aria-busy={pending}>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          {pending ? <Skeleton className="h-8 w-full rounded-lg" /> : (
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          )}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? <Skeleton className="mx-auto h-4 w-28 bg-primary-foreground/30" /> : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
