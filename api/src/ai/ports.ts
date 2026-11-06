import type { ChangeType, Fact, ProposedChange } from '@coach/contracts';
import type { WeekLoadImpact } from '../domain/plan-load.js';
import type { InjurySignal } from '../domain/injury-signal.js';

/**
 * Everything the agent can see or do. This interface IS the capability allowlist: read methods
 * over backend-computed data plus a single write, `createProposal`. There is no method that
 * edits the plan, so no tool can, whatever the model asks for. Implemented in services/coach-data.ts.
 *
 * The types are deliberately slimmer than the DB rows: only what the coach needs (no raw files,
 * GPS or emails) is ever placed in a prompt.
 */
export type AgentAthlete = {
  id: string;
  name: string;
  profile: {
    goal: string;
    raceName: string | null;
    raceDate: string | null;
    raceType: string | null;
    level: 'beginner' | 'intermediate' | 'advanced';
    availableDays: number[];
    maxHr: number | null;
    lthr: number | null;
    restingHrBaseline: number | null;
    hrZones: { z1Max: number; z2Max: number; z3Max: number; z4Max: number } | null;
  };
};

export type AgentWeek = {
  weekStart: string;
  totalDurationS: number;
  totalDistanceBySport: Record<string, number>;
  totalLoad: number;
  loadChangePct: number | null;
  atl: number;
  ctl: number;
  tsb: number;
  acwr: number | null;
  lowIntensityPct: number;
  highIntensityPct: number;
  hardSessions: number;
  maxConsecutiveHardDays: number;
  avgRestingHr: number | null;
  restingHrDelta: number | null;
};

export type AgentActivity = {
  id: string;
  date: string;
  sport: string;
  durationS: number;
  distanceM: number | null;
  avgHr: number | null;
  avgPaceSPerKm: number | null;
  trainingLoad: number | null;
  intensityClass: 'easy' | 'moderate' | 'hard' | null;
  timeInZonesS: number[] | null;
  rpe: number | null;
  note: string | null;
};

export type AgentCheckin = {
  id: string;
  date: string;
  restingHr: number | null;
  sleepHours: number | null;
  fatigue: number | null;
  soreness: number | null;
  note: string | null;
};

export type AgentPlannedWorkout = {
  id: string;
  date: string;
  sport: string;
  workoutType: string;
  title: string;
  description: string | null;
  durationMin: number;
  targetZone: number | null;
  plannedLoad: number;
  status: 'planned' | 'completed' | 'skipped';
};

export type AgentNoteHit = { id: string; sourceType: 'activity_note' | 'checkin_note'; date: string; content: string; matchedBy: ('text' | 'semantic')[] };

export type AgentProposalInput = {
  athleteId: string;
  agentRunId: string;
  workoutId: string;
  changeType: ChangeType;
  change: ProposedChange;
  reason: string;
  /** Facts the model cited, already resolved to backend values by the run's FactLedger. */
  citedFacts: Fact[];
  confidence: number;
  /** The model may raise the injury flag; only the backend can clear it (it never does). */
  modelInjuryConcern: boolean;
};

export type AgentProposalResult =
  | { ok: true; proposal: { id: string; status: 'pending' | 'awaiting_coach'; weeks: WeekLoadImpact[]; injury: InjurySignal } }
  | { ok: false; code: 'not_found' | 'invalid_change' | 'guardrail_violation'; message: string; violations?: string[]; weeks?: WeekLoadImpact[]; injury?: InjurySignal };

export interface CoachDataPort {
  getAthlete(athleteId: string): Promise<AgentAthlete | null>;
  listWeeks(athleteId: string, fromWeekStart: string, toWeekStart: string): Promise<AgentWeek[]>;
  /** Inclusive calendar-day range. */
  listActivities(athleteId: string, from: string, to: string): Promise<AgentActivity[]>;
  listCheckins(athleteId: string, from: string, to: string): Promise<AgentCheckin[]>;
  listPlannedWorkouts(athleteId: string, from: string, to: string): Promise<AgentPlannedWorkout[]>;
  listOpenProposalWorkoutIds(athleteId: string): Promise<string[]>;
  /** Backend injury detection over the last 7 days (same rule the proposal write path applies). */
  getInjurySignal(athleteId: string): Promise<InjurySignal>;
  searchNotes(athleteId: string, query: string, limit: number): Promise<{ hits: AgentNoteHit[]; mode: 'hybrid' | 'text' }>;
  /** The single write: inserts a proposal (pending or awaiting_coach) after the backend guardrails pass. */
  createProposal(input: AgentProposalInput): Promise<AgentProposalResult>;
}
