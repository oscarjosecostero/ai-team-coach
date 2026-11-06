"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Activity, CalendarDays, Inbox, LogOut, MessageCircle, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { useMe, useProposals, useRanking } from "@/lib/queries";
import { cn } from "cn";
import { SessionProvider, useSession } from "./session";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: Activity },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/proposals", label: "Proposals", icon: Inbox },
  { href: "/chat", label: "Coach chat", icon: MessageCircle, athleteOnly: true },
  { href: "/team", label: "Team", icon: Users },
];

/** Auth gate + navigation for every signed-in page. */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace("/login");
  }, [unauthenticated, router]);

  // Children always render (so Next can prerender each page's shell); views show their own
  // loading state while the session is null.
  return (
    <SessionProvider user={me.data ?? null}>
      <Chrome apiDown={Boolean(me.error) && !unauthenticated}>{children}</Chrome>
    </SessionProvider>
  );
}

function Chrome({ children, apiDown }: { children: ReactNode; apiDown: boolean }) {
  const { user, athleteId, setAthleteId } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const isCoach = user?.role === "coach";
  const pending = useProposals(isCoach ? undefined : user?.id, isCoach ? ["awaiting_coach"] : ["pending"], Boolean(user));
  const ranking = useRanking(isCoach);
  const badge = pending.data?.length ?? 0;

  const logout = async () => {
    await api.post("/auth/logout").catch(() => undefined);
    qc.clear();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-md bg-primary text-xs text-primary-foreground">TC</span>
            <span className="hidden sm:inline">Team Coach</span>
          </Link>
          <nav className="ml-2 flex flex-1 items-center gap-0.5 overflow-x-auto" aria-label="Main">
            {NAV.filter((n) => !(n.athleteOnly && isCoach)).map((n) => {
              const active = pathname.startsWith(n.href);
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    active && "bg-muted font-medium text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="hidden md:inline">{n.label}</span>
                  {(n.href === "/proposals" && !isCoach) || (n.href === "/team" && isCoach)
                    ? badge > 0 && (
                        <span className="rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground" aria-label={`${badge} waiting`}>
                          {badge}
                        </span>
                      )
                    : null}
                </Link>
              );
            })}
          </nav>
          {isCoach && ranking.data && (
            <label className="flex items-center gap-1.5 text-sm">
              <span className="hidden text-muted-foreground lg:inline">Viewing</span>
              <select
                className="h-8 rounded-md border bg-background px-2 text-sm"
                value={athleteId ?? ""}
                onChange={(e) => setAthleteId(e.target.value)}
                aria-label="Athlete to view"
              >
                {ranking.data.map((a) => (
                  <option key={a.athleteId} value={a.athleteId}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex items-center gap-2 pl-1">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user?.name}
              {isCoach && " · coach"}
            </span>
            <Button variant="ghost" size="icon-sm" onClick={logout} aria-label="Sign out" title="Sign out">
              <LogOut />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {apiDown && <p className="mb-4 rounded-lg border px-3 py-2 text-sm text-muted-foreground">Could not reach the API. Is it running?</p>}
        {children}
      </main>
    </div>
  );
}
