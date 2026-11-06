import { cn } from "cn";

export type Segment = { label: string; value: number; color: string };

/** Thin segmented bar (one whole split into parts): no text on the bar, figures beside it. */
export function SegmentedBar({ segments, label, className }: { segments: Segment[]; label: string; className?: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return null;
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex h-2 gap-0.5" role="img" aria-label={`${label}: ${visible.map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`).join(", ")}`}>
        {visible.map((s, i) => (
          <div
            key={s.label}
            title={`${s.label}: ${Math.round((s.value / total) * 100)}%`}
            className={cn(i === 0 && "rounded-l-full", i === visible.length - 1 && "rounded-r-full")}
            style={{ flexGrow: s.value, flexBasis: 0, background: s.color }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {visible.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.label} <span className="text-foreground tabular-nums">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const ZONE_COLORS = ["var(--viz-seq-250)", "var(--viz-seq-350)", "var(--viz-seq-450)", "var(--viz-seq-550)", "var(--viz-seq-650)"];
