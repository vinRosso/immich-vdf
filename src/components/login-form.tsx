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
      if (!response.ok) throw new Error(body.error || "Sign-in failed");
      router.replace(afterLogin);
      router.refresh();
    } catch (err) {
      if (err instanceof TypeError) {
        setError("Cannot reach the app. Run npm run dev and open the URL it prints (default port 47821).");
      } else {
        setError(err instanceof Error ? err.message : "Sign-in failed");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4">
      <p className="flex items-center gap-2 text-xs tracking-[0.22em] text-primary uppercase">
        <span aria-hidden className="size-1.5 rounded-full bg-primary" />
        Video Duplicate Finder
      </p>
      <h1 className="mt-2 font-heading text-5xl">Sign in</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        This app can read every mounted file and trash an Immich library. The password is <span className="text-foreground">APP_PASSWORD</span>, kept out of the image and out of the browser after this form.
      </p>
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
          {pending ? <Skeleton className="mx-auto h-4 w-28 bg-primary-foreground/30" /> : "Enter the library"}
        </Button>
      </form>
    </main>
  );
}
