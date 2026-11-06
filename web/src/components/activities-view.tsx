"use client";

import { ChevronDown, FileUp } from "lucide-react";
import { useEffect, useState } from "react";
import { SegmentedBar, ZONE_COLORS } from "@/components/charts/segmented-bar";
import { useSession } from "@/components/shell/session";
import { SportIcon } from "@/components/sport";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate, fmtDuration, fmtKm, fmtNum, fmtPace, fmtWeek, SPORT_LABEL, weekStartOf } from "@/lib/format";
import { useActivities, useDashboard } from "@/lib/queries";
import type { Activity } from "@/lib/types";
import { cn } from "cn";

const FILTERS = ["all", "swim", "bike", "run", "strength"] as const;
const INTENSITY = { easy: "Easy", moderate: "Moderate", hard: "Hard" } as const;
const LIMIT = 100;

/** Swim pace reads per 100 m, run pace per km, bike as speed: unit conversions of the stored pace only. */
function paceLabel(a: Activity): string | null {
  if (!a.avgPaceSPerKm) return null;
  if (a.sport === "run") return fmtPace(a.avgPaceSPerKm);
  if (a.sport === "swim") {
    const s = Math.round(a.avgPaceSPerKm / 10);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} /100 m`;
  }
  if (a.sport === "bike") return `${fmtNum(3600 / a.avgPaceSPerKm, 1)} km/h`;
  return null;
}

/**
 * The stored activities every metric is computed from: what was done, its load and intensity as the
 * backend computed them, and where it came from (seed data or an uploaded file).
 */
export function ActivitiesView() {
  const { athleteId, athleteName, user } = useSession();
  const list = useActivities(athleteId, { limit: LIMIT });
  const dash = useDashboard(athleteId); // weekly totals, as stored in weekly_metrics
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  // A calendar card links here as /activities#act-<id>: that activity starts open and scrolled into view.
  // (Rows only render client-side, once the query has data, so reading the hash here is hydration-safe.)
  const [open, setOpen] = useState<string | null>(() => (typeof window === "undefined" ? null : window.location.hash.replace(/^#act-/, "") || null));
  const [linked] = useState(open);
  useEffect(() => {
    if (linked && list.data) requestAnimationFrame(() => document.getElementById(`act-${linked}`)?.scrollIntoView({ block: "center" }));
  }, [linked, list.data]);

  const rows = (list.data ?? []).filter((a) => filter === "all" || a.sport === filter);
  const weeks: { weekStart: string; items: Activity[] }[] = [];
  for (const a of rows) {
    const wk = weekStartOf(a.startedAt.slice(0, 10));
    if (weeks.at(-1)?.weekStart !== wk) weeks.push({ weekStart: wk, items: [] });
    weeks.at(-1)!.items.push(a);
  }
  const weekLoad = new Map((dash.data?.weeklyHistory ?? []).map((w) => [w.weekStart, w.totalLoad]));
  const isSelf = user?.id === athleteId;

  return (
    <div className="space-y-6" data-testid="activities">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Activities</h1>
        <p className="text-sm text-muted-foreground">
          {isSelf ? "Your" : `${athleteName ?? "This athlete"}’s`} recorded sessions: the data every metric and proposal is computed from. Load and intensity are calculated by the backend from heart-rate zones.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by discipline">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={cn("rounded-full border px-3 py-1 text-sm font-semibold transition-colors", filter === f ? "brand-gradient border-transparent" : "bg-card text-muted-foreground hover:text-foreground")}
          >
            {f === "all" ? "All" : SPORT_LABEL[f]}
          </button>
        ))}
        {list.data && (
          <span className="ml-auto text-xs text-muted-foreground">
            {rows.length} of the latest {list.data.length} activities
          </span>
        )}
      </div>

      {list.isPending && <Skeleton className="h-96" />}
      {list.isError && <p className="text-sm text-muted-foreground">Could not load the activities.</p>}
      {list.data && rows.length === 0 && <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No activities for this filter.</p>}

      {weeks.map((w) => (
        <section key={w.weekStart} className="space-y-2" aria-label={`Week of ${fmtWeek(w.weekStart)}`}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="eyebrow">Week of {fmtWeek(w.weekStart)}</h2>
            {weekLoad.has(w.weekStart) && (
              <span className="text-sm text-muted-foreground tabular-nums">
                Week load <span className="font-bold text-foreground">{fmtNum(weekLoad.get(w.weekStart))} TRIMP</span>
              </span>
            )}
          </div>
          <ul className="divide-y overflow-hidden rounded-xl bg-card shadow-[0_1px_3px_rgb(16_24_40/0.06)] ring-1 ring-foreground/5">
            {w.items.map((a) => (
              <ActivityRow key={a.id} a={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ActivityRow({ a, open, onToggle }: { a: Activity; open: boolean; onToggle: () => void }) {
  const zones = a.timeInZonesS?.length === 5 ? a.timeInZonesS : null;
  const zoneTotal = zones?.reduce((s, z) => s + z, 0) ?? 0;
  const pace = paceLabel(a);
  return (
    <li id={`act-${a.id}`} data-testid="activity-row">
      <button type="button" onClick={onToggle} aria-expanded={open} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-muted/50 md:grid-cols-[auto_9rem_1fr_6rem_6rem_7rem_auto]">
        <SportIcon sport={a.sport} />
        <div className="min-w-0">
          <div className="text-sm font-bold">
            {SPORT_LABEL[a.sport]}
            {a.intensityClass && <span className="font-semibold text-muted-foreground"> · {INTENSITY[a.intensityClass]}</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            {fmtDate(a.startedAt.slice(0, 10))}
            {a.source === "file" && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 font-semibold text-primary">
                <FileUp className="size-3" aria-hidden /> uploaded
              </span>
            )}
          </div>
        </div>
        <div className="col-span-3 row-start-2 flex flex-wrap gap-x-4 gap-y-0.5 text-sm tabular-nums md:col-span-1 md:row-start-auto">
          <span>{fmtDuration(a.durationS)}</span>
          {a.distanceM ? <span>{fmtKm(a.distanceM)}</span> : null}
          {pace && <span className="text-muted-foreground">{pace}</span>}
        </div>
        <span className="hidden text-sm tabular-nums md:block">{a.avgHr ? `${a.avgHr} bpm` : "–"}</span>
        <span className="hidden text-sm font-bold tabular-nums md:block">{a.trainingLoad !== null ? `${fmtNum(a.trainingLoad)} TRIMP` : "–"}</span>
        <div className="hidden md:block" aria-hidden>
          {zones && zoneTotal > 0 ? (
            <div className="flex h-1.5 gap-px overflow-hidden rounded-full">
              {zones.map((z, i) => (z > 0 ? <div key={i} style={{ flexGrow: z, flexBasis: 0, background: ZONE_COLORS[i] }} /> : null))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">no HR</span>
          )}
        </div>
        <ChevronDown className={cn("col-start-3 row-start-1 size-4 text-muted-foreground transition-transform md:col-start-auto md:row-start-auto", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="space-y-4 bg-muted/40 px-4 py-4 md:pl-16">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Fact label="Duration" value={fmtDuration(a.durationS)} />
            <Fact label="Distance" value={fmtKm(a.distanceM)} />
            <Fact label={a.sport === "bike" ? "Speed" : "Pace"} value={pace} />
            <Fact label="Elevation gain" value={a.elevationGainM ? `${fmtNum(a.elevationGainM)} m` : null} />
            <Fact label="Avg / max HR" value={a.avgHr ? `${a.avgHr}${a.maxHr ? ` / ${a.maxHr}` : ""} bpm` : null} />
            <Fact label="Avg power" value={a.avgPowerW ? `${fmtNum(a.avgPowerW)} W` : null} />
            <Fact label="Training load" value={a.trainingLoad !== null ? `${fmtNum(a.trainingLoad)} TRIMP` : null} />
            <Fact label="Load method" value={a.loadMethod === "hr_trimp" ? "Heart-rate zones (TRIMP)" : a.loadMethod === "duration_estimate" ? "Estimated from duration" : null} />
          </dl>
          {zones && zoneTotal > 0 && <SegmentedBar label="Time in heart-rate zones" segments={zones.map((s, i) => ({ label: `Z${i + 1}`, value: s, color: ZONE_COLORS[i]! }))} />}
          {a.notes && <p className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground italic">“{a.notes}”</p>}
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{a.source === "file" ? "Uploaded file" : a.source === "strava" ? "Strava" : "Demo seed data"}</Badge>
            {a.intensityClass && <Badge variant="secondary">{INTENSITY[a.intensityClass]} intensity</Badge>}
          </div>
        </div>
      )}
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value ?? "–"}</dd>
    </div>
  );
}
