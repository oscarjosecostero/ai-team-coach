"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { AcwrMeter, StatTile, type Delta } from "@/components/charts/stat-tile";
import { SegmentedBar, ZONE_COLORS } from "@/components/charts/segmented-bar";
import { FitnessChart, WeeklyLoadChart } from "@/components/charts/trend-charts";
import { useSession } from "@/components/shell/session";
import { SportIcon } from "@/components/sport";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate, fmtDuration, fmtKm, fmtNum, fmtPace, fmtSigned, SPORT_LABEL } from "@/lib/format";
import { useDashboard, useProposals } from "@/lib/queries";
import type { Activity, Dashboard } from "@/lib/types";
import { AnalysisCard } from "./analysis-card";
import { CheckinForm } from "./checkin-form";
import { TodayCard } from "./today-card";
import { UploadCard } from "./upload-card";

export function DashboardView() {
  const { user, athleteId } = useSession();
  const dash = useDashboard(athleteId);
  const isCoach = user?.role === "coach";
  const open = useProposals(athleteId, isCoach ? ["awaiting_coach", "pending"] : ["pending"], Boolean(athleteId));

  if (!athleteId || dash.isPending) return <DashboardSkeleton />;
  if (dash.isError || !dash.data) return <p className="text-sm text-muted-foreground">Could not load the dashboard.</p>;
  const d = dash.data;
  const isSelf = user?.id === d.athlete.id;

  return (
    <div className="space-y-6" data-testid="dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{isSelf ? `Hi ${d.athlete.name.split(" ")[0]}` : d.athlete.name}</h1>
          <p className="text-sm text-muted-foreground">
            {d.profile?.goal}
            {d.profile?.raceName && d.daysToRace !== null && (
              <>
                {" · "}
                <span className="font-semibold text-foreground">{d.profile.raceName}</span> in {d.daysToRace} days
              </>
            )}
          </p>
        </div>
        {d.pendingProposals > 0 && isSelf && (
          <Link href="/proposals" className="brand-edge flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-xs hover:brightness-[0.98]" data-testid="pending-proposals-banner">
            <Inbox className="size-4 text-primary" aria-hidden />
            {d.pendingProposals === 1 ? "1 proposal from your coach" : `${d.pendingProposals} proposals from your coach`}
            <span aria-hidden>→</span>
          </Link>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <TodayCard key={d.today} today={d.today} workouts={d.upcomingWorkouts} proposals={open.data ?? []} reviewHref={isSelf ? "/proposals" : "/team"} />
        <div className="space-y-4">
          <AnalysisCard athleteId={d.athlete.id} />
          <LatestActivity activity={d.latestActivity} />
        </div>
      </div>

      <KpiRow d={d} />

      <div className="grid gap-4 lg:grid-cols-2">
        <WeeklyLoadChart weeks={d.weeklyHistory} currentWeekStart={d.currentWeek?.weekStart ?? ""} />
        <FitnessChart weeks={d.weeklyHistory} />
      </div>

      {isSelf && (
        <div className="grid gap-4 lg:grid-cols-2">
          <UploadCard />
          <CheckinForm key={d.latestCheckin?.id ?? "none"} latest={d.latestCheckin} today={d.today} />
        </div>
      )}
    </div>
  );
}

const dir = (n: number): Delta["direction"] => (n > 0 ? "up" : n < 0 ? "down" : "flat");

function KpiRow({ d }: { d: Dashboard }) {
  const w = d.currentWeek;
  const loadDelta: Delta | undefined =
    w?.loadChangePct !== null && w?.loadChangePct !== undefined
      ? { text: `${fmtSigned(w.loadChangePct, 0, "%")}`, direction: dir(w.loadChangePct), tone: "neutral", label: "vs same days last week" }
      : undefined;
  const rhr = w?.restingHrDelta;
  const rhrDelta: Delta | undefined =
    rhr !== null && rhr !== undefined ? { text: `${fmtSigned(rhr, 1)} bpm`, direction: dir(rhr), tone: rhr >= 3 ? "bad" : rhr <= -1 ? "good" : "neutral", label: "vs your baseline" } : undefined;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="kpis">
      <StatTile label="Training load this week" value={fmtNum(w?.totalLoad)} unit="TRIMP" delta={loadDelta}>
        {w && (
          <SegmentedBar
            className="pt-1"
            label="Intensity split"
            segments={[
              { label: "Low (Z1–Z2)", value: w.lowIntensityPct, color: "var(--viz-series-1)" },
              { label: "High (Z3–Z5)", value: w.highIntensityPct, color: "var(--viz-series-2)" },
            ]}
          />
        )}
      </StatTile>
      <StatTile label="Acute:chronic load" value={fmtNum(w?.acwr, 2)}>
        <AcwrMeter value={w?.acwr ?? null} />
      </StatTile>
      <StatTile label="Hard sessions this week" value={fmtNum(w?.hardSessions)}>
        <span className="text-xs text-muted-foreground">
          {w && w.maxConsecutiveHardDays >= 3 ? (
            <span style={{ color: "var(--status-critical)" }}>▲ {w.maxConsecutiveHardDays} hard days in a row</span>
          ) : (
            `Longest hard streak: ${w?.maxConsecutiveHardDays ?? 0} day(s)`
          )}
        </span>
      </StatTile>
      <StatTile label="Resting HR (week average)" value={fmtNum(w?.avgRestingHr, 1)} unit="bpm" delta={rhrDelta} />
    </div>
  );
}

function LatestActivity({ activity: a }: { activity: Activity | null }) {
  if (!a) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Latest activity</CardTitle>
          <CardDescription>No activities yet. Upload a .fit or .gpx file.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const facts = [
    ["Duration", fmtDuration(a.durationS)],
    ["Distance", fmtKm(a.distanceM)],
    ["Pace", a.sport === "run" ? fmtPace(a.avgPaceSPerKm) : null],
    ["Avg HR", a.avgHr ? `${a.avgHr} bpm` : null],
    ["Load", a.trainingLoad !== null ? `${fmtNum(a.trainingLoad)} TRIMP` : null],
  ].filter((x): x is [string, string] => Boolean(x[1]));
  const zones = a.timeInZonesS?.length === 5 ? a.timeInZonesS : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SportIcon sport={a.sport} className="size-7" /> Latest activity {a.intensityClass && <Badge variant={a.intensityClass === "hard" ? "default" : "secondary"}>{a.intensityClass}</Badge>}
        </CardTitle>
        <CardDescription>
          {SPORT_LABEL[a.sport]} · {fmtDate(a.startedAt.slice(0, 10))}
          {a.source === "file" && " · uploaded file"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-3 gap-x-4 gap-y-2">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="text-sm font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {zones && (
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">Time in heart-rate zones</div>
            <SegmentedBar label="Time in heart-rate zones" segments={zones.map((s, i) => ({ label: `Z${i + 1}`, value: s, color: ZONE_COLORS[i]! }))} />
          </div>
        )}
        {a.notes && <p className="border-l-2 pl-3 text-sm text-muted-foreground italic">“{a.notes}”</p>}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
