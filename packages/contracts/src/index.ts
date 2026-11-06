import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['ok', 'down']),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

// ---------- Phase 2: auth, check-ins, proposals ----------

export const roleSchema = z.enum(['athlete', 'coach']);
export type Role = z.infer<typeof roleSchema>;

export const loginRequestSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const demoLoginRequestSchema = z.object({ email: z.string().email() });
export type DemoLoginRequest = z.infer<typeof demoLoginRequestSchema>;

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  role: roleSchema,
  name: z.string(),
  email: z.string().email(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const checkinRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  restingHr: z.number().int().min(25).max(120).nullable().optional(),
  sleepHours: z.number().min(0).max(24).nullable().optional(),
  fatigue: z.number().int().min(1).max(5).nullable().optional(),
  soreness: z.number().int().min(1).max(5).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type CheckinRequest = z.infer<typeof checkinRequestSchema>;

export const sportSchema = z.enum(['run', 'bike', 'swim', 'strength', 'other']);
export const workoutTypeSchema = z.enum(['easy', 'long', 'tempo', 'intervals', 'recovery', 'strength', 'brick', 'rest']);
export const changeTypeSchema = z.enum(['replace', 'reduce', 'move', 'rest']);
export type ChangeType = z.infer<typeof changeTypeSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * What a proposal changes on one planned workout. Which fields are required depends on `changeType`
 * (see `proposedChangeFor`); this shape is stored in `proposals.proposed_change`.
 */
export const proposedChangeSchema = z.object({
  date: isoDate.optional(),
  sport: sportSchema.optional(),
  workoutType: workoutTypeSchema.optional(),
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  durationMin: z.number().int().min(0).max(600).optional(),
  targetZone: z.number().int().min(1).max(5).nullable().optional(),
});
export type ProposedChange = z.infer<typeof proposedChangeSchema>;

export const coachReviewRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), note: z.string().max(1000).optional(), edit: proposedChangeSchema.optional() }),
  z.object({ action: z.literal('reject'), note: z.string().max(1000).optional() }),
]);
export type CoachReviewRequest = z.infer<typeof coachReviewRequestSchema>;

export const decisionRequestSchema = z.object({ note: z.string().max(1000).optional() }).default({});

export const proposalStatusSchema = z.enum(['awaiting_coach', 'pending', 'accepted', 'rejected', 'expired']);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
