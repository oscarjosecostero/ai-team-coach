"use client";

import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SessionProfile } from "@/components/charts/session-profile";
import { SportIcon, sportColor } from "@/components/sport";
import { Card, CardContent } from "@/components/ui/card";
import { addDays, fmtDate, fmtMinutes, fmtNum, SPORT_LABEL, TYPE_LABEL } from "@/lib/format";
import type { PlannedWorkout, Proposal } from "@/lib/types";
import { cn } from "cn";

const CHANGE = { reduce: "a shorter session", replace: "a different session", move: "moving this session", rest: "a rest day" } as const;

/**
 * "What do I do today": a seven-day strip (a dot per session in its discipline color, a marker where
 * the coach has a suggestion) and the selected day's session with its intensity profile. A pending
 * proposal for that session shows right there, linked to the decision.
 */
export function TodayCard({ today, workouts, proposals, reviewHref }: { today: string; workouts: PlannedWorkout[]; proposals: Proposal[]; reviewHref: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const byDay = new Map<string, PlannedWorkout[]>();
  for (const w of workouts) byDay.set(w.date, [...(byDay.get(w.date) ?? []), w]);
  const proposalFor = new Map(proposals.map((p) => [p.plannedWorkoutId, p]));
  const firstSession = days.find((d) => byDay.get(d)?.some((w) => w.workoutType !== "rest")) ?? today;
  const [selected, setSelected] = useState(firstSession);
  const idx = days.indexOf(selected);
  const sessions = byDay.get(selected) ?? [];

  return (
    <Card className="gap-0 py-0" data-testid="today-card">
      <div className="flex items-center justify-center gap-4 border-b px-4 py-3">
        <button type="button" className="grid size-8 place-items-center rounded-full border text-muted-foreground hover:bg-muted disabled:opacity-40" onClick={() => setSelected(days[idx - 1]!)} disabled={idx <= 0} aria-label="Previous day">
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-32 text-center text-sm font-bold tracking-wide uppercase underline underline-offset-4">{selected === today ? `Today · ${fmtDate(selected, { day: "numeric", month: "short" })}` : fmtDate(selected)}</span>
        <button type="button" className="grid size-8 place-items-center rounded-full border text-muted-foreground hover:bg-muted disabled:opacity-40" onClick={() => setSelected(days[idx + 1]!)} disabled={idx >= days.length - 1} aria-label="Next day">
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 border-b" role="tablist" aria-label="Next seven days">
        {days.map((d) => {
          const items = byDay.get(d) ?? [];
          const suggestion = items.some((w) => proposalFor.has(w.id));
          const active = d === selected;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelected(d)}
              className={cn("relative flex flex-col items-center gap-1 px-1 py-2.5 text-muted-foreground transition-colors hover:bg-muted/60", active && "text-foreground")}
            >
              <span className="text-[11px] font-semibold uppercase">{d === today ? "Today" : fmtDate(d, { weekday: "short" })}</span>
              <span className={cn("text-lg leading-none tabular-nums", active ? "font-extrabold" : "font-semibold")}>{fmtDate(d, { day: "numeric" })}</span>
              <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
                {items.map((w) => (
                  <span key={w.id} className={cn("h-1 w-3 rounded-full", w.workoutType === "rest" && "w-1.5")} style={{ background: w.workoutType === "rest" ? "var(--sport-other)" : sportColor(w.sport) }} />
                ))}
              </span>
              {suggestion && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary" title="Your coach has a suggestion for this day" />}
              {active && <span className="brand-gradient absolute inset-x-2 bottom-0 h-0.5 rounded-full" aria-hidden />}
              <span className="sr-only">{items.length ? items.map((w) => (w.workoutType === "rest" ? "Rest" : `${SPORT_LABEL[w.sport]} ${w.title}`)).join(", ") : "Nothing planned"}{suggestion ? ", coach suggestion" : ""}</span>
            </button>
          );
        })}
      </div>

      <CardContent className="space-y-5 py-4">
        {sessions.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nothing planned for this day.</p>}
        {sessions.map((w) => {
          const p = proposalFor.get(w.id);
          return (
            <div key={w.id} className="space-y-4" data-testid={`today-session-${w.date}`}>
              <div className="flex items-center gap-3">
                <SportIcon sport={w.sport} rest={w.workoutType === "rest"} className="size-10" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-bold">{w.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {w.workoutType === "rest" ? "Rest day" : `${SPORT_LABEL[w.sport]} · ${TYPE_LABEL[w.workoutType]}`}
                    {w.origin === "proposal" && " · updated by an accepted proposal"}
                  </div>
                </div>
                {w.workoutType !== "rest" && <span className="rounded-lg bg-muted px-3 py-1.5 text-base font-bold tabular-nums">{fmtMinutes(w.durationMin)}</span>}
              </div>
              {w.workoutType !== "rest" && (
                <>
                  <SessionProfile blocks={w.shape} height={150} />
                  <dl className="grid grid-cols-3 gap-3 text-center">
                    <Fact label="Planned load" value={`${fmtNum(w.plannedLoad)} TRIMP`} />
                    <Fact label="Main zone" value={mainZone(w)} />
                    <Fact label="Duration" value={fmtMinutes(w.durationMin)} />
                  </dl>
                </>
              )}
              {p && (
                <div className="brand-edge relative rounded-xl px-4 pt-3 pb-5 text-center" data-testid="today-suggestion">
                  <p className="text-sm">
                    <Sparkles className="mr-1 inline size-4 text-primary" aria-hidden />
                    Your coach suggests <span className="font-semibold">{CHANGE[p.changeType]}</span>
                    {p.proposed && p.workout && p.proposed.durationMin !== p.workout.durationMin && (
                      <span className="tabular-nums">
                        {" "}
                        ({fmtMinutes(p.workout.durationMin)} → {fmtMinutes(p.proposed.durationMin)})
                      </span>
                    )}
                    .
                  </p>
                  <Link href={reviewHref} className="brand-gradient absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-xs font-semibold shadow-sm">
                    See why and decide
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

const mainZone = (w: PlannedWorkout) => {
  const b = w.shape.find((x) => x.phase === "main" || x.phase === "work");
  return b ? `Z${b.zone}` : "–";
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-2">
      <dt className="text-[11px] font-semibold text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm font-bold tabular-nums">{value}</dd>
    </div>
  );
}
