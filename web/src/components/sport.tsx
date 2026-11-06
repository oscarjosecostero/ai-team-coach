import { Activity, Bike, Dumbbell, Footprints, Moon, Waves, type LucideIcon } from "lucide-react";
import { SPORT_LABEL } from "@/lib/format";
import { cn } from "cn";

const ICON: Record<string, LucideIcon> = { swim: Waves, bike: Bike, run: Footprints, strength: Dumbbell, other: Activity };

/** Discipline color token; strength and other share the neutral one. */
export const sportColor = (sport: string) => (sport === "swim" || sport === "bike" || sport === "run" ? `var(--sport-${sport})` : "var(--sport-other)");

/** A discipline disc: icon on the sport color. Identity never relies on color alone (icon + accessible label). */
export function SportIcon({ sport, rest, className }: { sport: string; rest?: boolean; className?: string }) {
  const Icon = rest ? Moon : (ICON[sport] ?? Activity);
  return (
    <span
      className={cn("grid size-8 shrink-0 place-items-center rounded-full text-white", className)}
      style={{ background: rest ? "var(--sport-other)" : sportColor(sport) }}
      role="img"
      aria-label={rest ? "Rest" : (SPORT_LABEL[sport] ?? sport)}
    >
      <Icon className="size-[55%]" aria-hidden />
    </span>
  );
}

/** Outlined ring with a value inside and a label under it (the sidebar's week-at-a-glance). */
export function SportRing({ sport, value, label }: { sport: string; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="grid size-12 place-items-center rounded-full border-[3px] text-sm font-extrabold tabular-nums" style={{ borderColor: sportColor(sport) }}>
        {value}
      </span>
      <span className="text-[11px] leading-none text-sidebar-muted">{label}</span>
    </div>
  );
}
