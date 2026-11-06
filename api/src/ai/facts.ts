import type { Fact } from '@coach/contracts';

/**
 * Per-run registry of every fact a read tool returned. The model cites facts by ID; the backend
 * resolves IDs here and stores *these* values, so no number in the UI ever comes from model text.
 * An ID the run never saw (made up, or simply not fetched) does not resolve.
 */
export class FactLedger {
  private readonly facts = new Map<string, Fact>();
  /** Planned workouts the model has seen via get_calendar; proposals may only target these. */
  private readonly workouts = new Set<string>();

  add(fact: Fact): Fact {
    this.facts.set(fact.id, fact);
    return fact;
  }

  addAll(facts: Fact[]): Fact[] {
    return facts.map((f) => this.add(f));
  }

  get(id: string): Fact | undefined {
    return this.facts.get(id);
  }

  resolve(ids: string[]): { found: Fact[]; unknown: string[] } {
    const found: Fact[] = [];
    const unknown: string[] = [];
    for (const id of new Set(ids)) {
      const f = this.facts.get(id);
      if (f) found.push(f);
      else unknown.push(id);
    }
    return { found, unknown };
  }

  seeWorkout(id: string): void {
    this.workouts.add(id);
  }

  hasSeenWorkout(id: string): boolean {
    return this.workouts.has(id);
  }

  get size(): number {
    return this.facts.size;
  }
}

const short = (uuid: string) => uuid.replace(/-/g, '').slice(0, 8);

/** Stable, readable fact IDs. Readable on purpose: models cite "wk:2026-11-02:acwr" reliably. */
export const factIds = {
  week: (weekStart: string, metric: string) => `wk:${weekStart}:${metric}`,
  activity: (activityId: string, metric: string) => `act:${short(activityId)}:${metric}`,
  checkin: (date: string, metric: string) => `chk:${date}:${metric}`,
  workout: (workoutId: string, metric: string) => `pw:${short(workoutId)}:${metric}`,
  planWeek: (weekStart: string, metric: string) => `plan:${weekStart}:${metric}`,
  note: (noteId: string) => `note:${short(noteId)}`,
  profile: (metric: string) => `profile:${metric}`,
  signal: (name: string) => `signal:${name}`,
};

/** Chat answers cite facts inline as [[fact-id]]. */
const CITATION_RE = /\[\[([a-z]+:[A-Za-z0-9:_.-]+)\]\]/g;

export function extractCitations(text: string): string[] {
  return [...text.matchAll(CITATION_RE)].map((m) => m[1]!);
}

/** Resolves inline citations; unknown ones are removed from the text so nothing unbacked is shown. */
export function resolveCitations(text: string, ledger: FactLedger): { text: string; citations: Fact[]; unknown: string[] } {
  const { found, unknown } = ledger.resolve(extractCitations(text));
  const unknownSet = new Set(unknown);
  const cleaned = text.replace(CITATION_RE, (m, id: string) => (unknownSet.has(id) ? '' : m)).replace(/[ \t]+([.,;:!?])/g, '$1');
  return { text: cleaned, citations: found, unknown };
}
