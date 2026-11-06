import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType: (config) => `vector(${config?.dimensions ?? 1024})`,
  toDriver: (value) => `[${value.join(',')}]`,
  fromDriver: (value) => value.slice(1, -1).split(',').map(Number),
});

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  coachReviewEnabled: boolean('coach_review_enabled').notNull().default(false),
  createdAt: createdAt(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  role: text('role', { enum: ['athlete', 'coach'] }).notNull(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

export const athleteProfiles = pgTable('athlete_profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  goal: text('goal').notNull(),
  raceName: text('race_name'),
  raceDate: date('race_date', { mode: 'string' }),
  raceType: text('race_type'),
  level: text('level', { enum: ['beginner', 'intermediate', 'advanced'] }).notNull(),
  availableDays: smallint('available_days').array().notNull().default(sql`'{}'::smallint[]`),
  maxHr: smallint('max_hr'),
  lthr: smallint('lthr'),
  restingHrBaseline: smallint('resting_hr_baseline'),
  hrZones: jsonb('hr_zones').$type<{ z1Max: number; z2Max: number; z3Max: number; z4Max: number }>(),
});

export const SPORTS = ['run', 'bike', 'swim', 'strength', 'other'] as const;
export type Sport = (typeof SPORTS)[number];

export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['seed', 'file', 'strava'] }).notNull(),
    sourceId: text('source_id').notNull(),
    sport: text('sport', { enum: SPORTS }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    durationS: integer('duration_s').notNull(),
    movingTimeS: integer('moving_time_s'),
    distanceM: real('distance_m'),
    elevationGainM: real('elevation_gain_m'),
    avgHr: smallint('avg_hr'),
    maxHr: smallint('max_hr'),
    avgPaceSPerKm: real('avg_pace_s_per_km'),
    avgPowerW: real('avg_power_w'),
    timeInZonesS: integer('time_in_zones_s').array(),
    trainingLoad: numeric('training_load', { precision: 8, scale: 1, mode: 'number' }),
    loadMethod: text('load_method', { enum: ['hr_trimp', 'duration_estimate'] }),
    intensityClass: text('intensity_class', { enum: ['easy', 'moderate', 'hard'] }),
    rpe: smallint('rpe'),
    notes: text('notes'),
    raw: jsonb('raw'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('activities_source_source_id_uq').on(t.source, t.sourceId),
    index('activities_user_started_idx').on(t.userId, t.startedAt),
  ],
);

export const wellnessCheckins = pgTable(
  'wellness_checkins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    restingHr: smallint('resting_hr'),
    sleepHours: real('sleep_hours'),
    fatigue: smallint('fatigue'),
    soreness: smallint('soreness'),
    note: text('note'),
  },
  (t) => [unique('wellness_user_date_uq').on(t.userId, t.date)],
);

export const weeklyMetrics = pgTable(
  'weekly_metrics',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    totalDurationS: integer('total_duration_s').notNull(),
    totalDistanceBySport: jsonb('total_distance_by_sport').$type<Record<string, number>>().notNull(),
    totalLoad: real('total_load').notNull(),
    loadChangePct: real('load_change_pct'),
    atl: real('atl').notNull(),
    ctl: real('ctl').notNull(),
    tsb: real('tsb').notNull(),
    acwr: real('acwr'),
    lowIntensityPct: real('low_intensity_pct').notNull(),
    highIntensityPct: real('high_intensity_pct').notNull(),
    hardSessions: smallint('hard_sessions').notNull(),
    maxConsecutiveHardDays: smallint('max_consecutive_hard_days').notNull(),
    avgRestingHr: real('avg_resting_hr'),
    restingHrDelta: real('resting_hr_delta'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.weekStart] })],
);

export const WORKOUT_TYPES = ['easy', 'long', 'tempo', 'intervals', 'recovery', 'strength', 'brick', 'rest'] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];

export const plannedWorkouts = pgTable(
  'planned_workouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    sport: text('sport', { enum: SPORTS }).notNull(),
    workoutType: text('workout_type', { enum: WORKOUT_TYPES }).notNull(),
    title: text('title').notNull(),
    description: text('description'),
    durationMin: integer('duration_min').notNull(),
    targetZone: smallint('target_zone'),
    plannedLoad: real('planned_load').notNull().default(0),
    status: text('status', { enum: ['planned', 'completed', 'skipped'] }).notNull().default('planned'),
    completedActivityId: uuid('completed_activity_id').references(() => activities.id, { onDelete: 'set null' }),
    origin: text('origin', { enum: ['seed', 'manual', 'proposal'] }).notNull(),
    version: integer('version').notNull().default(1),
  },
  (t) => [index('planned_workouts_user_date_idx').on(t.userId, t.date)],
);

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    sourceType: text('source_type', { enum: ['activity_note', 'checkin_note'] }).notNull(),
    sourceId: uuid('source_id').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', content)`),
    embeddingModel: text('embedding_model'),
    createdAt: createdAt(),
  },
  (t) => [
    index('knowledge_chunks_user_idx').on(t.userId),
    index('knowledge_chunks_tsv_idx').using('gin', t.tsv),
    index('knowledge_chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    unique('knowledge_chunks_source_uq').on(t.sourceType, t.sourceId),
  ],
);

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['post_activity', 'weekly', 'chat'] }).notNull(),
  trigger: text('trigger').notNull(),
  model: text('model').notNull(),
  status: text('status', { enum: ['running', 'succeeded', 'failed'] }).notNull(),
  toolTrace: jsonb('tool_trace'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cacheReadTokens: integer('cache_read_tokens'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    plannedWorkoutId: uuid('planned_workout_id').notNull().references(() => plannedWorkouts.id),
    plannedWorkoutVersion: integer('planned_workout_version').notNull(),
    changeType: text('change_type', { enum: ['replace', 'reduce', 'move', 'rest'] }).notNull(),
    proposedChange: jsonb('proposed_change').notNull(),
    reason: text('reason').notNull(),
    evidence: jsonb('evidence').notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2, mode: 'number' }),
    status: text('status', { enum: ['awaiting_coach', 'pending', 'accepted', 'rejected', 'expired'] }).notNull(),
    coachNote: text('coach_note'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('proposals_user_status_idx').on(t.userId, t.status)],
);

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorType: text('actor_type', { enum: ['agent', 'athlete', 'coach', 'system'] }).notNull(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  metadata: jsonb('metadata'),
  createdAt: createdAt(),
});

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});
