import { ZONE_COLORS } from "@/components/charts/segmented-bar";
import type { SessionBlock } from "@/lib/types";
import { cn } from "cn";

const PHASE: Record<SessionBlock["phase"], string> = { warmup: "Warm-up", main: "Main set", work: "Work", recover: "Recover", cooldown: "Cool-down" };
const zoneColor = (z: number) => ZONE_COLORS[Math.min(5, Math.max(1, z)) - 1]!;

/** "Warm-up 6′ · 5 × 6′ @ Z4 · Cool-down 9′": the profile in words (the caption and the accessible name). */
export function describeShape(blocks: SessionBlock[]): string {
  const work = blocks.filter((b) => b.phase === "work");
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.phase === "work" || b.phase === "recover") continue;
    parts.push(b.phase === "main" ? `${PHASE.main} ${b.minutes}′ @ Z${b.zone}` : `${PHASE[b.phase]} ${b.minutes}′`);
    if (b.phase === "warmup" && work.length) parts.push(`${work.length} × ${work[0]!.minutes}′ @ Z${work[0]!.zone}`);
  }
  return parts.join(" · ");
}

/**
 * Intensity profile of a planned session, as computed by the backend: block width is minutes, height
 * and color are the heart-rate zone (one-hue sequential ramp). Each block has its own hover/focus
 * tooltip; the caption states the same profile in words.
 */
export function SessionProfile({ blocks, className, height = 96 }: { blocks: SessionBlock[]; className?: string; height?: number }) {
  if (blocks.length === 0) return <p className={cn("text-sm text-muted-foreground", className)}>Rest: no intensity profile.</p>;
  const label = describeShape(blocks);
  return (
    <figure className={cn("space-y-2", className)}>
      <div className="flex items-end gap-0.5 border-b border-(--viz-axis)" style={{ height }} role="img" aria-label={`Intensity profile: ${label}`}>
        {blocks.map((b, i) => (
          <div key={i} className="group relative flex h-full items-end outline-none" style={{ flexGrow: b.minutes, flexBasis: 0 }} tabIndex={0} aria-label={`${PHASE[b.phase]}: ${b.minutes} min at zone ${b.zone}`}>
            <div className="w-full rounded-t-[4px] transition-opacity group-hover:opacity-80" style={{ height: `${(b.zone / 5) * 100}%`, background: zoneColor(b.zone) }} />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {PHASE[b.phase]} · {b.minutes} min · Z{b.zone}
            </div>
          </div>
        ))}
      </div>
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

/** The same profile as a thin stripe (calendar cards): width is minutes, color is zone. */
export function SessionStripe({ blocks, className }: { blocks: SessionBlock[]; className?: string }) {
  if (blocks.length === 0) return <div className={cn("h-1.5 rounded-full bg-muted", className)} aria-hidden />;
  return (
    <div className={cn("flex h-1.5 gap-px overflow-hidden rounded-full", className)} role="img" aria-label={`Intensity profile: ${describeShape(blocks)}`}>
      {blocks.map((b, i) => (
        <div key={i} style={{ flexGrow: b.minutes, flexBasis: 0, background: zoneColor(b.zone) }} />
      ))}
    </div>
  );
}
