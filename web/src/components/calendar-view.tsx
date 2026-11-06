"use client";

import { useSession } from "@/components/shell/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { addDays, fmtDate, fmtMinutes, fmtNum, fmtWeek, SPORT_LABEL, TYPE_LABEL, weekStartOf } from "@/lib/format";
import { useCalendar, useDashboard } from "@/lib/queries";
import type { PlannedWorkout } from "@/lib/types";

/** The current week plus the next two (the seeded plan covers 14 days ahead). */
export function CalendarView() {
  const { athleteId } = useSession();
  const dash = useDashboard(athleteId); // gives "today" as the server sees it
  const today = dash.data?.today;
  const from = today ? weekStartOf(today) : "";
  const to = today ? addDays(from, 20) : "";
  const cal = useCalendar(today ? athleteId : undefined, from, to);

  if (!today || cal.isPending) return <Skeleton className="h-96" />;
  if (cal.isError || !cal.data) return <p className="text-sm text-muted-foreground">Could not load the calendar.</p>;

  const weeks = [0, 1, 2].map((i) => addDays(from, i * 7));
  const loadByWeek = new Map(cal.data.weeks.map((w) => [w.weekStart, w.plannedLoad]));

  return (
    <div className="space-y-6" data-testid="calendar">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <p className="text-sm text-muted-foreground">Your plan changes only when you accept a proposal. Changed sessions are marked.</p>
      </div>
      {weeks.map((wk) => {
        const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(wk, i));
        const byDay = new Map<string, PlannedWorkout[]>();
        for (const w of cal.data.workouts) if (w.date >= wk && w.date <= days[6]!) byDay.set(w.date, [...(byDay.get(w.date) ?? []), w]);
        return (
          <Card key={wk}>
            <CardHeader>
              <CardTitle>Week of {fmtWeek(wk)}</CardTitle>
              <CardDescription>Planned load {fmtNum(loadByWeek.get(wk) ?? 0)} TRIMP</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {days.map((day) => {
                  const items = byDay.get(day) ?? [];
                  const past = day < today;
                  return (
                    <li key={day} className={`flex gap-4 py-2.5 ${past ? "opacity-60" : ""}`} data-date={day}>
                      <div className="w-24 shrink-0 text-sm">
                        <span className={day === today ? "font-semibold" : "text-muted-foreground"}>{fmtDate(day)}</span>
                        {day === today && <span className="block text-xs text-muted-foreground">today</span>}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        {items.length === 0 && <span className="text-sm text-muted-foreground">{past ? "—" : "Nothing planned"}</span>}
                        {items.map((w) => (
                          <div key={w.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1" data-testid={`workout-${w.date}`}>
                            <span className="text-sm font-medium">{w.title}</span>
                            <span className="text-sm text-muted-foreground">
                              {w.workoutType === "rest" ? "Rest" : `${SPORT_LABEL[w.sport]} · ${TYPE_LABEL[w.workoutType]} · ${fmtMinutes(w.durationMin)}`}
                              {w.targetZone ? ` · Z${w.targetZone}` : ""}
                            </span>
                            {w.plannedLoad > 0 && <span className="text-xs text-muted-foreground tabular-nums">{fmtNum(w.plannedLoad)} TRIMP</span>}
                            {w.origin === "proposal" && <Badge variant="outline">Updated by an accepted proposal</Badge>}
                            {w.status !== "planned" && <Badge variant="secondary">{w.status}</Badge>}
                          </div>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
