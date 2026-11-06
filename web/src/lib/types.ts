import type { Fact, ProposedChange, Role } from "@coach/contracts";

/** Response shapes of the API, as JSON (dates are ISO strings). Request schemas live in @coach/contracts. */
export type { Fact };

export type SessionUser = { id: string; teamId: string; role: Role; name: string; email: string };
export type DemoAccount = { name: string; email: string; role: Role };

export type Sport = "run" | "bike" | "swim" | "strength" | "other";
export type WorkoutType = "easy" | "long" | "tempo" | "intervals" | "recovery" | "strength" | "brick" | "rest";

export type Profile = {
  goal: string;
  raceName: string | null;
  raceDate: string | null;
  raceType: string | null;
  level: "beginner" | "intermediate" | "advanced";
  lthr: number | null;
  maxHr: number | null;
  restingHrBaseline: number | null;
};

export type Activity = {
  id: string;
  sport: Sport;
  startedAt: string;
  durationS: number;
  distanceM: number | null;
  avgHr: number | null;
  avgPaceSPerKm: number | null;
  trainingLoad: number | null;
  intensityClass: "easy" | "moderate" | "hard" | null;
  timeInZonesS: number[] | null;
  notes: string | null;
  source: "seed" | "file" | "strava";
};

export type WeeklyMetrics = {
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

/** One block of a planned session's intensity profile, computed by the backend (domain/session-shape.ts). */
export type SessionBlock = { phase: "warmup" | "main" | "work" | "recover" | "cooldown"; minutes: number; zone: number };

export type PlannedWorkout = {
  id: string;
  date: string;
  sport: Sport;
  workoutType: WorkoutType;
  title: string;
  description: string | null;
  durationMin: number;
  targetZone: number | null;
  plannedLoad: number;
  status: "planned" | "completed" | "skipped";
  origin: "seed" | "manual" | "proposal";
  version: number;
  shape: SessionBlock[];
};

export type Checkin = { id: string; date: string; restingHr: number | null; sleepHours: number | null; fatigue: number | null; soreness: number | null; note: string | null };

export type Dashboard = {
  athlete: { id: string; name: string };
  profile: Profile | null;
  today: string;
  daysToRace: number | null;
  latestActivity: Activity | null;
  recentActivities: Activity[];
  currentWeek: WeeklyMetrics | null;
  previousWeek: WeeklyMetrics | null;
  weeklyHistory: WeeklyMetrics[];
  upcomingWorkouts: PlannedWorkout[];
  latestCheckin: Checkin | null;
  pendingProposals: number;
};

export type ProposalStatus = "awaiting_coach" | "pending" | "accepted" | "rejected" | "expired";
export type Proposal = {
  id: string;
  userId: string;
  athleteName: string;
  plannedWorkoutId: string;
  plannedWorkoutVersion: number;
  changeType: "replace" | "reduce" | "move" | "rest";
  proposedChange: ProposedChange;
  reason: string;
  evidence: Fact[];
  confidence: number | null;
  status: ProposalStatus;
  coachNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  workout: (Omit<PlannedWorkout, "status" | "origin"> & { version: number }) | null;
  /** The workout as it would be after the change, applied by the backend. */
  proposed: Omit<PlannedWorkout, "id" | "status" | "origin" | "version"> | null;
};

export type AgentRun = {
  id: string;
  kind: "post_activity" | "weekly" | "chat";
  trigger: string;
  model: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  summary: string | null;
  citations: Fact[];
  proposalIds: string[];
};

/** GET /analysis/runs/:id: one run plus the proposals it created (those this viewer may see). */
export type AgentRunDetail = AgentRun & { proposals: Proposal[] };

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string; citations: Fact[] };

export type RankingRow = { rank: number; athleteId: string; name: string; weekStart: string; totalDurationS: number; totalLoad: number; hardSessions: number; acwr: number | null };
