import { defaultZoneFor } from './load.js';

export type SessionPhase = 'warmup' | 'main' | 'work' | 'recover' | 'cooldown';

/** One block of a planned session: how long, at which heart-rate zone (1-5). */
export type SessionBlock = { phase: SessionPhase; minutes: number; zone: number };

type ShapeInput = { workoutType: string; durationMin: number; targetZone: number | null };

const INTERVAL_REPS = 5;

/**
 * The schematic shape of a planned session, for the intensity profile in the UI: warm-up, main set
 * (work/recover repeats for intervals) and cool-down, from the workout type, duration and target zone.
 * Deterministic and pure: the blocks always add up to `durationMin`, and the main zone is the one
 * `plannedWorkoutLoad` uses (rounded to a whole zone), so the picture and the planned load agree.
 * Plans carry no interval structure, so this is a template per type, not a prescription.
 */
export function sessionShape(w: ShapeInput): SessionBlock[] {
  const total = Math.max(0, Math.round(w.durationMin));
  const main = Math.round(w.targetZone ?? defaultZoneFor(w.workoutType));
  if (total === 0 || main <= 0 || w.workoutType === 'rest') return [];

  if (w.workoutType === 'recovery' || total < 20) return [{ phase: 'main', minutes: total, zone: Math.max(1, main) }];

  if (w.workoutType === 'intervals') {
    const warm = Math.round(total * 0.2);
    const cool = Math.round(total * 0.15);
    const set = total - warm - cool;
    // Work:recover 2:1 per rep; whatever rounding leaves goes to the last recovery.
    const work = Math.max(1, Math.floor((set * 2) / 3 / INTERVAL_REPS));
    const rec = Math.max(1, Math.floor(set / 3 / INTERVAL_REPS));
    const reps = Math.min(INTERVAL_REPS, Math.floor(set / (work + rec)));
    const blocks: SessionBlock[] = [{ phase: 'warmup', minutes: warm, zone: 1 }];
    for (let i = 0; i < reps; i++) blocks.push({ phase: 'work', minutes: work, zone: main }, { phase: 'recover', minutes: rec, zone: 1 });
    const used = blocks.reduce((s, b) => s + b.minutes, 0);
    blocks[blocks.length - 1]!.minutes += total - cool - used;
    blocks.push({ phase: 'cooldown', minutes: cool, zone: 1 });
    return blocks.filter((b) => b.minutes > 0);
  }

  // Steady sessions (easy, long, tempo, brick, strength): warm-up, main block, cool-down.
  const share = w.workoutType === 'tempo' || w.workoutType === 'brick' ? 0.15 : 0.1;
  const warm = Math.round(total * share);
  const cool = Math.round(total * share);
  const easyZone = Math.max(1, Math.min(main - 1, 2));
  return [
    { phase: 'warmup' as const, minutes: warm, zone: easyZone },
    { phase: 'main' as const, minutes: total - warm - cool, zone: main },
    { phase: 'cooldown' as const, minutes: cool, zone: easyZone },
  ].filter((b) => b.minutes > 0);
}
