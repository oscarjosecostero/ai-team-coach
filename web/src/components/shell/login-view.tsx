"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { keys, useDemoAccounts } from "@/lib/queries";
import type { SessionUser } from "@/lib/types";

const STORY: Record<string, string> = {
  "carlos@teamcoach.demo": "Three hard days in a row, resting HR rising",
  "marcos@teamcoach.demo": "First sprint tri, load jumped in two weeks",
  "ana@teamcoach.demo": "70.3 qualifier, consistent build",
  "lucia@teamcoach.demo": "Working on the open-water swim",
  "diego@teamcoach.demo": "Tapering for a December duathlon",
};

export function LoginView() {
  const router = useRouter();
  const qc = useQueryClient();
  const demo = useDemoAccounts();
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Next keeps visited routes alive (React <Activity>). When this page is hidden after a login,
  // reset the transient state so coming back after a logout shows usable buttons and no password.
  useLayoutEffect(
    () => () => {
      setBusy(null);
      setPassword("");
    },
    [],
  );

  const start = async (path: string, body: unknown, key: string) => {
    setBusy(key);
    try {
      const { user } = await api.post<{ user: SessionUser }>(path, body);
      qc.clear();
      qc.setQueryData(keys.me, user);
      router.replace(user.role === "coach" ? "/team" : "/dashboard");
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(null);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void start("/auth/login", { email, password }, "form");
  };

  const accounts = demo.data ?? [];
  const athletes = accounts.filter((a) => a.role === "athlete");
  const coaches = accounts.filter((a) => a.role === "coach");

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="grid w-full max-w-4xl gap-6 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">Team Coach</h1>
            <p className="text-muted-foreground">
              An AI coach for a triathlon group. The backend computes every number from your training data; the coach explains it and
              proposes plan changes; you decide.
            </p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Try the demo</CardTitle>
              <CardDescription>One click, no password. Each athlete has a different story in the data.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {demo.isPending && <p className="text-sm text-muted-foreground">Loading demo accounts…</p>}
              {demo.isError && <p className="text-sm text-muted-foreground">Demo logins are not available on this server.</p>}
              {[...athletes, ...coaches].map((a) => (
                <button
                  key={a.email}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void start("/auth/demo-login", { email: a.email }, a.email)}
                  className="group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted disabled:opacity-60"
                  data-testid={`demo-login-${a.email.split("@")[0]}`}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-sm font-medium">
                    {a.name
                      .split(" ")
                      .map((p) => p[0])
                      .join("")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {a.name} {a.role === "coach" && <span className="font-normal text-muted-foreground">· coach</span>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{a.role === "coach" ? "Team view, ranking and proposal review queue" : STORY[a.email] ?? a.email}</span>
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription>Seeded accounts share the demo password.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={busy !== null}>
                  {busy === "form" ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            </CardContent>
          </Card>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
              Proposals cite the exact backend figures behind them.
            </li>
            <li className="flex gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              The coach never edits your plan: you accept or reject, and every decision is audited.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
