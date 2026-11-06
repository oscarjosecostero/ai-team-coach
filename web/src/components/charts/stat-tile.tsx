import type { ReactNode } from "react";
import { cn } from "cn";

/** Direction (arrow) and tone (good/bad color) are independent: resting HR going up is bad. */
export type Delta = { text: string; direction: "up" | "down" | "flat"; tone: "good" | "bad" | "neutral"; label: string };

/** Stat tile: label · value · optional delta vs a named period · optional footnote. */
export function StatTile({ label, value, unit, delta, children, className }: { label: string; value: ReactNode; unit?: string; delta?: Delta; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-xl bg-card p-4 ring-1 ring-foreground/10", className)}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </span>
      {delta && (
        <span
          className={cn("text-xs", delta.tone === "neutral" && "text-muted-foreground")}
          style={delta.tone === "good" ? { color: "var(--delta-good)" } : delta.tone === "bad" ? { color: "var(--status-critical)" } : undefined}
        >
          {delta.direction === "up" ? "▲ " : delta.direction === "down" ? "▼ " : ""}
          {delta.text} <span className="text-muted-foreground">{delta.label}</span>
        </span>
      )}
      {children}
    </div>
  );
}

/**
 * ACWR meter: a 0-2 track with the 0.8-1.3 comfort band marked. The fill carries severity
 * (accent inside the band, warning above 1.3, critical above 1.5), always with a text label.
 */
export function AcwrMeter({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted-foreground">Not enough history yet</span>;
  const pct = Math.min(100, (value / 2) * 100);
  const state = value > 1.5 ? { color: "var(--status-critical)", label: "High injury risk" } : value > 1.3 ? { color: "var(--status-warning)", label: "Above the comfort range" } : value < 0.8 ? { color: "var(--viz-muted)", label: "Below usual load" } : { color: "var(--viz-series-1)", label: "In the 0.8–1.3 range" };
  return (
    <div className="space-y-1.5" role="meter" aria-valuemin={0} aria-valuemax={2} aria-valuenow={value} aria-label="Acute to chronic workload ratio">
      <div className="relative h-2 rounded-full" style={{ background: "var(--viz-track)" }}>
        <div className="absolute inset-y-0 border-x border-background/80" style={{ left: "40%", width: "25%", background: "color-mix(in oklch, var(--viz-series-1) 25%, transparent)" }} aria-hidden />
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: state.color }} />
      </div>
      <span className="text-xs text-muted-foreground">{state.label}</span>
    </div>
  );
}
