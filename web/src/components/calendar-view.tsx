"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ZONE_COLORS } from "@/components/charts/segmented-bar";
import { SessionStripe } from "@/components/charts/session-profile";
import { useSession } from "@/components/shell/session";
import { SportIcon } from "@/components/sport";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { addDays, fmtDate, fmtDuration, fmtMinutes, fmtNum, fmtWeek, SPORT_LABEL, TYPE_LABEL, weekStartOf } from "@/lib/format";
import { useActivities, useCalendar, useDashboard, useProposals } from "@/lib/queries";
import type { Activity, PlannedWorkout } from "@/lib/types";
import { cn } from "cn";

/**
 * Three weeks, one column per day: what was done (stored activities) up to today, what is planned
 * from today on. Starts at the current week; the arrows move a week at a time.
 */
export function CalendarView() {
  const { user, athleteId } = useSession();
  const dash = useDashboard(athleteId); // gives "today" as the server sees it
  const today = dash.data?.today;
  const [offset, setOffset] = useState(0);
  const from = today ? addDays(weekStartOf(today), offset * 7) : "";
  const to = today ? addDays(from, 20) : "";
  const cal = useCalendar(today ? athleteId : undefined, from, to);
  const doneTo = today && to > today ? today : to;
  const done = useActivities(today && from <= today ? athleteId : undefined, { from, to: doneTo });
  const open = useProposals(athleteId, user?.role === "coach" ? ["awaiting_coach", "pending"] : ["pending"], Boolean(athleteId));

  if (!today || cal.isPending) return <Skeleton className="h-96" />;
  if (cal.isError || !cal.data) return <p className="text-sm text-muted-foreground">Could not load the calendar.</p>;

  const weeks = [0, 1, 2].map((i) => addDays(from, i * 7));
  const loadByWeek = new Map(cal.data.weeks.map((w) => [w.weekStart, w.plannedLoad]));
  const suggested = new Set((open.data ?? []).map((p) => p.plannedWorkoutId));

  return (
    <div className="space-y-8" data-testid="calendar">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">Done sessions up to today, the plan from today on. The plan changes only when you accept a proposal.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="grid size-8 place-items-center rounded-full border bg-card text-muted-foreground hover:text-foreground" onClick={() => setOffset(offset - 1)} aria-label="Previous week">
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-36 text-center text-sm font-bold tracking-wide uppercase underline underline-offset-4">
            {fmtWeek(from)} – {fmtWeek(addDays(from, 20))}
          </span>
          <button type="button" className="grid size-8 place-items-center rounded-full border bg-card text-muted-foreground hover:text-foreground" onClick={() => setOffset(offset + 1)} aria-label="Next week">
            <ChevronRight className="size-4" />
          </button>
          {offset !== 0 && (
            <button type="button" className="rounded-full border bg-card px-3 py-1 text-xs font-semibold" onClick={() => setOffset(0)}>
              This week
            </button>
          )}
        </div>
      </div>
      {weeks.map((wk) => {
        const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(wk, i));
        const inWeek = cal.data.workouts.filter((w) => w.date >= wk && w.date <= days[6]!);
        const minutes = inWeek.reduce((s, w) => s + w.durationMin, 0);
        const doneInWeek = (done.data ?? []).filter((a) => a.startedAt.slice(0, 10) >= wk && a.startedAt.slice(0, 10) <= days[6]!);
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
                const did = doneInWeek.filter((a) => a.startedAt.slice(0, 10) === day);
                const past = day < today;
                return (
                  <li key={day} className={cn("flex min-h-36 flex-col gap-2 rounded-xl bg-muted/70 p-2", day === today && "ring-2 ring-primary/50")} data-date={day}>
                    <div className="pt-1 text-center text-xs font-bold tracking-wide uppercase">
                      {fmtDate(day, { weekday: "short", month: "short", day: "numeric" })}
                      {day === today && <span className="block text-[11px] font-semibold text-primary normal-case">today</span>}
                    </div>
                    {items.length === 0 && did.length === 0 && <p className="m-auto px-2 text-center text-xs text-muted-foreground">{past ? "No activity" : "No sessions scheduled"}</p>}
                    {did.map((a) => (
                      <DoneCard key={a.id} a={a} />
                    ))}
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

/** A recorded activity on a past day: what was actually done, linked to its detail in Activities. */
function DoneCard({ a }: { a: Activity }) {
  const zones = a.timeInZonesS?.length === 5 && a.timeInZonesS.some((z) => z > 0) ? a.timeInZonesS : null;
  return (
    <Link href={`/activities#act-${a.id}`} className="block space-y-2 rounded-lg border border-dashed border-foreground/15 bg-card/60 p-2.5 hover:bg-card" data-testid={`activity-${a.startedAt.slice(0, 10)}`}>
      <div className="flex items-center justify-between gap-2">
        <SportIcon sport={a.sport} className="size-7" />
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-bold tabular-nums">{fmtDuration(a.durationS)}</span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--delta-good)" }}>
          <Check className="size-3" aria-hidden /> Done
        </div>
        <div className="truncate text-sm leading-tight font-bold">
          {SPORT_LABEL[a.sport]}
          {a.intensityClass && <span className="font-semibold text-muted-foreground"> · {a.intensityClass}</span>}
        </div>
      </div>
      {zones ? (
        <div className="flex h-1.5 gap-px overflow-hidden rounded-full" role="img" aria-label="Time in heart-rate zones">
          {zones.map((z, i) => (z > 0 ? <div key={i} style={{ flexGrow: z, flexBasis: 0, background: ZONE_COLORS[i] }} /> : null))}
        </div>
      ) : (
        <div className="h-1.5 rounded-full bg-muted" aria-hidden />
      )}
      <div className="text-[11px] text-muted-foreground tabular-nums">{a.trainingLoad !== null ? `${fmtNum(a.trainingLoad)} TRIMP` : "No load"}</div>
    </Link>
  );
}
