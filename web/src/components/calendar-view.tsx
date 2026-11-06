"use client";

import { SessionStripe } from "@/components/charts/session-profile";
import { useSession } from "@/components/shell/session";
import { SportIcon } from "@/components/sport";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { addDays, fmtDate, fmtMinutes, fmtNum, fmtWeek, SPORT_LABEL, TYPE_LABEL, weekStartOf } from "@/lib/format";
import { useCalendar, useDashboard, useProposals } from "@/lib/queries";
import type { PlannedWorkout } from "@/lib/types";
import { cn } from "cn";

/** The current week plus the next two (the seeded plan covers 14 days ahead), one column per day. */
export function CalendarView() {
  const { user, athleteId } = useSession();
  const dash = useDashboard(athleteId); // gives "today" as the server sees it
  const today = dash.data?.today;
  const from = today ? weekStartOf(today) : "";
  const to = today ? addDays(from, 20) : "";
  const cal = useCalendar(today ? athleteId : undefined, from, to);
  const open = useProposals(athleteId, user?.role === "coach" ? ["awaiting_coach", "pending"] : ["pending"], Boolean(athleteId));

  if (!today || cal.isPending) return <Skeleton className="h-96" />;
  if (cal.isError || !cal.data) return <p className="text-sm text-muted-foreground">Could not load the calendar.</p>;

  const weeks = [0, 1, 2].map((i) => addDays(from, i * 7));
  const loadByWeek = new Map(cal.data.weeks.map((w) => [w.weekStart, w.plannedLoad]));
  const suggested = new Set((open.data ?? []).map((p) => p.plannedWorkoutId));

  return (
    <div className="space-y-8" data-testid="calendar">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Calendar</h1>
        <p className="text-sm text-muted-foreground">Your plan changes only when you accept a proposal. Changed sessions are marked.</p>
      </div>
      {weeks.map((wk) => {
        const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(wk, i));
        const inWeek = cal.data.workouts.filter((w) => w.date >= wk && w.date <= days[6]!);
        const minutes = inWeek.reduce((s, w) => s + w.durationMin, 0);
        return (
          <section key={wk} className="space-y-3" aria-label={`Week of ${fmtWeek(wk)}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="eyebrow">Week of {fmtWeek(wk)}</h2>
              <span className="text-sm text-muted-foreground tabular-nums">
                Planned load <span className="font-bold text-foreground">{fmtNum(loadByWeek.get(wk) ?? 0)} TRIMP</span> · {fmtMinutes(minutes)}
              </span>
            </div>
            <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
              {days.map((day) => {
                const items = inWeek.filter((w) => w.date === day);
                const past = day < today;
                return (
                  <li key={day} className={cn("flex min-h-36 flex-col gap-2 rounded-xl bg-muted/70 p-2", past && "opacity-60", day === today && "ring-2 ring-primary/50")} data-date={day}>
                    <div className="pt-1 text-center text-xs font-bold tracking-wide uppercase">
                      {fmtDate(day, { weekday: "short", month: "short", day: "numeric" })}
                      {day === today && <span className="block text-[11px] font-semibold text-primary normal-case">today</span>}
                    </div>
                    {items.length === 0 && <p className="m-auto px-2 text-center text-xs text-muted-foreground">{past ? "—" : "No sessions scheduled"}</p>}
                    {items.map((w) => (
                      <WorkoutCard key={w.id} w={w} suggested={suggested.has(w.id)} />
                    ))}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function WorkoutCard({ w, suggested }: { w: PlannedWorkout; suggested: boolean }) {
  const rest = w.workoutType === "rest";
  return (
    <div className={cn("space-y-2 rounded-lg bg-card p-2.5 shadow-[0_1px_2px_rgb(16_24_40/0.08)]", suggested && "brand-edge")} data-testid={`workout-${w.date}`}>
      <div className="flex items-center justify-between gap-2">
        <SportIcon sport={w.sport} rest={rest} className="size-7" />
        {!rest && <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-bold tabular-nums">{fmtMinutes(w.durationMin)}</span>}
      </div>
      <div className="min-w-0">
        <div className="line-clamp-2 text-sm leading-tight font-bold" title={w.title}>
          {w.title}
        </div>
        <div className="truncate text-xs text-muted-foreground">{rest ? "Rest" : `${SPORT_LABEL[w.sport]} · ${TYPE_LABEL[w.workoutType]}${w.targetZone ? ` · Z${w.targetZone}` : ""}`}</div>
      </div>
      <SessionStripe blocks={w.shape} />
      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted-foreground">
        <span className="tabular-nums">{w.plannedLoad > 0 ? `${fmtNum(w.plannedLoad)} TRIMP` : "No load"}</span>
        {w.status !== "planned" && <Badge variant="secondary">{w.status}</Badge>}
      </div>
      {w.origin === "proposal" && <Badge variant="outline" className="w-full justify-center whitespace-normal">Updated by an accepted proposal</Badge>}
      {suggested && <p className="text-[11px] font-semibold text-primary">Coach suggestion waiting</p>}
    </div>
  );
}
