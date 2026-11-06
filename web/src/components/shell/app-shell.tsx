"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Activity, CalendarDays, Inbox, LogOut, MessageCircle, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { SportRing } from "@/components/sport";
import { api, ApiError } from "@/lib/api";
import { fmtNum } from "@/lib/format";
import { useDashboard, useMe, useProposals, useRanking } from "@/lib/queries";
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
  const dash = useDashboard(athleteId);
  const badge = pending.data?.length ?? 0;
  const nav = NAV.filter((n) => !(n.athleteOnly && isCoach));
  const badgeFor = (href: string) => ((href === "/proposals" && !isCoach) || (href === "/team" && isCoach) ? badge : 0);
  const km = dash.data?.currentWeek?.totalDistanceBySport ?? {};
  const ring = (sport: string) => (km[sport] ? fmtNum(km[sport] / 1000, 1) : "–");

  const logout = async () => {
    await api.post("/auth/logout").catch(() => undefined);
    qc.clear();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-full flex-1">
      {/* Desktop: dark slate sidebar. */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <Link href="/dashboard" className="flex items-center gap-2 bg-black/15 px-5 py-4 text-lg font-extrabold tracking-tight">
          <Mark /> Team Coach
        </Link>
        <div className="px-4 pt-5 pb-4">
          <div className="flex justify-between" aria-label="Distance this week by discipline">
            <SportRing sport="swim" value={ring("swim")} label="km swim" />
            <SportRing sport="bike" value={ring("bike")} label="km bike" />
            <SportRing sport="run" value={ring("run")} label="km run" />
          </div>
          {isCoach && dash.data && <p className="mt-2 text-center text-[11px] text-sidebar-muted">{dash.data.athlete.name} · this week</p>}
        </div>
        {isCoach && ranking.data && (
          <label className="mx-4 mb-3 block text-xs text-sidebar-muted">
            Viewing
            <select
              className="mt-1 h-9 w-full rounded-lg border border-sidebar-border bg-sidebar-accent px-2 text-sm text-sidebar-foreground"
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
        <nav className="flex-1 space-y-0.5 px-3" aria-label="Main">
          {nav.map((n) => {
            const active = pathname.startsWith(n.href);
            const Icon = n.icon;
            const count = badgeFor(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-bold text-sidebar-muted transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                  active && "bg-sidebar-accent text-sidebar-foreground",
                )}
              >
                <span className="flex-1">{n.label}</span>
                {count > 0 && (
                  <span className="brand-gradient rounded-full px-1.5 text-[11px]" aria-label={`${count} waiting`}>
                    {count}
                  </span>
                )}
                <Icon className="size-4" aria-hidden />
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3 bg-black/15 px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sidebar-foreground text-sm font-extrabold text-sidebar" aria-hidden>
            {initials(user?.name)}
          </span>
          <div className="min-w-0 flex-1 text-sm leading-tight">
            <div className="truncate font-bold">{user?.name}</div>
            <div className="text-xs text-sidebar-muted">{isCoach ? "Coach" : "Athlete"}</div>
          </div>
          <button type="button" onClick={logout} aria-label="Sign out" title="Sign out" className="grid size-8 place-items-center rounded-md bg-sidebar-accent text-sidebar-muted hover:text-sidebar-foreground">
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile and tablet: compact top bar. */}
        <header className="sticky top-0 z-20 bg-sidebar text-sidebar-foreground lg:hidden">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <Link href="/dashboard" className="flex items-center gap-2 font-extrabold" aria-label="Team Coach">
              <Mark />
            </Link>
            <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto" aria-label="Main">
              {nav.map((n) => {
                const active = pathname.startsWith(n.href);
                const Icon = n.icon;
                const count = badgeFor(n.href);
                return (
                  <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} aria-label={n.label} className={cn("relative flex shrink-0 items-center rounded-md p-2 text-sidebar-muted", active && "bg-sidebar-accent text-sidebar-foreground")}>
                    <Icon className="size-5" aria-hidden />
                    {count > 0 && <span className="absolute top-1 right-1 size-2 rounded-full bg-primary" aria-hidden />}
                  </Link>
                );
              })}
            </nav>
            {isCoach && ranking.data && (
              <select className="h-8 max-w-32 rounded-md border border-sidebar-border bg-sidebar-accent px-1 text-sm" value={athleteId ?? ""} onChange={(e) => setAthleteId(e.target.value)} aria-label="Athlete to view">
                {ranking.data.map((a) => (
                  <option key={a.athleteId} value={a.athleteId}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
            <button type="button" onClick={logout} aria-label="Sign out" className="grid size-8 place-items-center rounded-md text-sidebar-muted">
              <LogOut className="size-4" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8">
          {apiDown && <p className="mb-4 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">Could not reach the API. Is it running?</p>}
          {children}
        </main>
      </div>
    </div>
  );
}

/** Our own mark: a gradient disc with a pulse line. */
function Mark() {
  return (
    <span className="brand-gradient grid size-7 place-items-center rounded-full" aria-hidden>
      <Activity className="size-4" />
    </span>
  );
}

const initials = (name?: string) =>
  (name ?? "")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
