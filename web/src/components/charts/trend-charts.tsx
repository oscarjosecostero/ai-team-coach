"use client";

import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtNum, fmtWeek } from "@/lib/format";
import type { WeeklyMetrics } from "@/lib/types";

/** Round tick values (1, 2, 2.5 or 5 x 10^n steps, about four intervals) from 0 to just above max. */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100);
}

const AXIS = { stroke: "var(--viz-axis)", tick: { fill: "var(--viz-muted)", fontSize: 12 }, tickLine: false } as const;

/** Card with a chart and a table view of the same numbers (tooltips enhance, never gate). */
function ChartCard({ title, description, chart, table }: { title: string; description: string; chart: ReactNode; table: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Button variant="ghost" size="xs" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
            {showTable ? "Chart" : "Table"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>{showTable ? table : chart}</CardContent>
    </Card>
  );
}

function TooltipBox({ title, rows }: { title: string; rows: { key: ReactNode; label: string; value: string }[] }) {
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 text-muted-foreground">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          {r.key}
          <span className="font-semibold text-foreground tabular-nums">{r.value}</span>
          <span className="text-muted-foreground">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

const lineKey = (color: string) => <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: color }} aria-hidden />;

/** Weekly training load: one series, columns (magnitude per week), latest value labeled. */
export function WeeklyLoadChart({ weeks, currentWeekStart }: { weeks: WeeklyMetrics[]; currentWeekStart: string }) {
  const data = weeks.map((w) => ({ week: w.weekStart, load: Math.round(w.totalLoad), partial: w.weekStart === currentWeekStart }));
  const last = data.length - 1;
  const loadTicks = niceTicks(Math.max(...data.map((x) => x.load)));
  const chart = (
    <div className="h-52" data-testid="weekly-load-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis dataKey="week" tickFormatter={fmtWeek} {...AXIS} />
          <YAxis {...AXIS} axisLine={false} width={56} ticks={loadTicks} domain={[0, loadTicks.at(-1)!]} tickFormatter={(v: number) => fmtNum(v)} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={({ active, payload }: TooltipContentProps<ValueType, NameType>) =>
              active && payload?.length ? (
                <TooltipBox
                  title={`Week of ${fmtWeek(String(payload[0]!.payload.week))}${payload[0]!.payload.partial ? " (so far)" : ""}`}
                  rows={[{ key: <span className="size-2 rounded-sm" style={{ background: "var(--viz-series-1)" }} />, label: "TRIMP", value: fmtNum(Number(payload[0]!.value)) }]}
                />
              ) : null
            }
          />
          <Bar dataKey="load" fill="var(--viz-series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
            <LabelList
              dataKey="load"
              position="top"
              content={({ x, y, width, value, index }) =>
                index === last ? (
                  <text x={Number(x) + Number(width) / 2} y={Number(y) - 6} textAnchor="middle" fontSize={12} fill="var(--foreground)">
                    {fmtNum(Number(value))}
                  </text>
                ) : null
              }
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
  return (
    <ChartCard
      title="Weekly training load"
      description="TRIMP per week, computed from time in heart-rate zones. The current week is so far."
      chart={chart}
      table={
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">Week of</th>
              <th className="py-1 text-right font-normal">Load (TRIMP)</th>
              <th className="py-1 text-right font-normal">Change</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {weeks.map((w) => (
              <tr key={w.weekStart} className="border-t">
                <td className="py-1">{fmtWeek(w.weekStart)}</td>
                <td className="py-1 text-right">{fmtNum(w.totalLoad)}</td>
                <td className="py-1 text-right">{w.loadChangePct === null ? "–" : `${fmtNum(w.loadChangePct, 1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}

/** Fitness (CTL) vs fatigue (ATL): two series of the same unit on one axis, legend + end labels. */
export function FitnessChart({ weeks }: { weeks: WeeklyMetrics[] }) {
  const data = weeks.map((w) => ({ week: w.weekStart, ctl: w.ctl, atl: w.atl }));
  const last = data.length - 1;
  const fitTicks = niceTicks(Math.max(...data.flatMap((x) => [x.ctl, x.atl])));
  const endLabel = (name: string) =>
    function EndLabel({ x, y, index }: { x?: number | string; y?: number | string; index?: number }) {
      return index === last ? (
        <text x={Number(x) + 8} y={Number(y) + 4} fontSize={12} fill="var(--muted-foreground)">
          {name}
        </text>
      ) : null;
    };
  const chart = (
    <div className="space-y-2">
      <ul className="flex gap-4 text-xs text-muted-foreground" aria-label="Legend">
        <li className="flex items-center gap-1.5">{lineKey("var(--viz-series-1)")} Fitness (CTL, 42-day)</li>
        <li className="flex items-center gap-1.5">{lineKey("var(--viz-series-2)")} Fatigue (ATL, 7-day)</li>
      </ul>
      <div className="h-52" data-testid="fitness-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 56, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
            <XAxis dataKey="week" tickFormatter={fmtWeek} {...AXIS} />
            <YAxis {...AXIS} axisLine={false} width={56} ticks={fitTicks} domain={[0, fitTicks.at(-1)!]} tickFormatter={(v: number) => fmtNum(v)} />
            <Tooltip
              cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }}
              content={({ active, payload, label }: TooltipContentProps<ValueType, NameType>) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={`Week of ${fmtWeek(String(label))}`}
                    rows={[
                      { key: lineKey("var(--viz-series-1)"), label: "Fitness (CTL)", value: fmtNum(Number(payload.find((p) => p.dataKey === "ctl")?.value), 1) },
                      { key: lineKey("var(--viz-series-2)"), label: "Fatigue (ATL)", value: fmtNum(Number(payload.find((p) => p.dataKey === "atl")?.value), 1) },
                    ]}
                  />
                ) : null
              }
            />
            <Line type="monotone" dataKey="ctl" stroke="var(--viz-series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} isAnimationActive={false}>
              <LabelList content={endLabel("CTL")} />
            </Line>
            <Line type="monotone" dataKey="atl" stroke="var(--viz-series-2)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} isAnimationActive={false}>
              <LabelList content={endLabel("ATL")} />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
  return (
    <ChartCard
      title="Fitness and fatigue"
      description="When fatigue rises well above fitness, the body needs time to absorb the work."
      chart={chart}
      table={
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">Week of</th>
              <th className="py-1 text-right font-normal">Fitness (CTL)</th>
              <th className="py-1 text-right font-normal">Fatigue (ATL)</th>
              <th className="py-1 text-right font-normal">Form (TSB)</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {weeks.map((w) => (
              <tr key={w.weekStart} className="border-t">
                <td className="py-1">{fmtWeek(w.weekStart)}</td>
                <td className="py-1 text-right">{fmtNum(w.ctl, 1)}</td>
                <td className="py-1 text-right">{fmtNum(w.atl, 1)}</td>
                <td className="py-1 text-right">{fmtNum(w.tsb, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}
