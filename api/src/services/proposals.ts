import { proposedChangeSchema, type CoachReviewRequest, type ProposedChange } from '@coach/contracts';
import type { Db } from '../db/client.js';
import { toIsoDate } from '../domain/dates.js';
import { applyProposedChange, validateChangeShape, type WorkoutFields } from '../domain/proposal-change.js';
import type { Actor, Clock } from '../lib/actor.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { auditRepo } from '../repositories/audit.js';
import { plannedWorkoutsRepo, type PlannedWorkoutRow } from '../repositories/planned-workouts.js';
import { proposalsRepo, type ProposalRow } from '../repositories/proposals.js';
import { teamsRepo } from '../repositories/teams.js';
import { usersRepo } from '../repositories/users.js';
import { requireCoach } from './access.js';

export type ProposalDeps = { db: Db; now: Clock; afterPlanChange?: (userId: string, weekStart: string) => Promise<void> };

const workoutFields = (w: PlannedWorkoutRow): WorkoutFields => ({
  date: w.date,
  sport: w.sport,
  workoutType: w.workoutType,
  title: w.title,
  description: w.description,
  durationMin: w.durationMin,
  targetZone: w.targetZone,
});

const snapshot = (w: PlannedWorkoutRow) => ({ ...workoutFields(w), plannedLoad: w.plannedLoad, version: w.version });

async function loadVisible(db: Db, actor: Actor, id: string): Promise<ProposalRow> {
  const p = await proposalsRepo.getById(db, id);
  if (!p) throw notFound('Proposal');
  await assertCanSee(db, actor, p);
  return p;
}

async function assertCanSee(db: Db, actor: Actor, p: ProposalRow): Promise<void> {
  if (actor.id === p.userId) {
    // An athlete never sees proposals still waiting on the coach.
    if (p.status === 'awaiting_coach') throw notFound('Proposal');
    return;
  }
  const owner = await proposalsRepo.getWorkoutOwnerTeam(db, p.plannedWorkoutId);
  if (actor.role === 'coach' && owner && owner.teamId === actor.teamId) return;
  throw notFound('Proposal'); // do not reveal that it exists
}

/** A proposal as the UI needs it: plus the target workout as it is now, and whose proposal it is. */
export type ProposalView = ProposalRow & {
  athleteName: string;
  workout: (WorkoutFields & { id: string; plannedLoad: number; version: number }) | null;
};

async function toViews(db: Db, rows: ProposalRow[]): Promise<ProposalView[]> {
  const workouts = new Map((await plannedWorkoutsRepo.getByIds(db, [...new Set(rows.map((r) => r.plannedWorkoutId))])).map((w) => [w.id, w]));
  const names = new Map<string, string>();
  for (const id of new Set(rows.map((r) => r.userId))) names.set(id, (await usersRepo.findById(db, id))?.name ?? 'Unknown');
  return rows.map((p) => {
    const w = workouts.get(p.plannedWorkoutId);
    return { ...p, athleteName: names.get(p.userId)!, workout: w ? { id: w.id, ...snapshot(w) } : null };
  });
}

export const proposalService = {
  async list(deps: ProposalDeps, actor: Actor, opts: { status?: ProposalRow['status'][]; athleteId?: string }): Promise<ProposalView[]> {
    const { db } = deps;
    if (actor.role === 'coach') {
      const all = await proposalsRepo.listForTeam(db, actor.teamId, opts.status);
      return toViews(db, opts.athleteId ? all.filter((p) => p.userId === opts.athleteId) : all);
    }
    if (opts.athleteId && opts.athleteId !== actor.id) throw forbidden();
    const rows = await proposalsRepo.listForUser(db, actor.id, opts.status);
    return toViews(db, rows.filter((p) => p.status !== 'awaiting_coach'));
  },

  async get(deps: ProposalDeps, actor: Actor, id: string): Promise<ProposalView> {
    const [view] = await toViews(deps.db, [await loadVisible(deps.db, actor, id)]);
    return view!;
  },

  /** Athlete accepts: apply the change to the calendar, atomically, with an audit trail. */
  async accept(deps: ProposalDeps, actor: Actor, id: string, note?: string): Promise<ProposalRow> {
    const today = toIsoDate(deps.now());
    const result = await deps.db.transaction(async (tx) => {
      const proposal = await lockOwnPending(tx, actor, id);
      const workout = await plannedWorkoutsRepo.getByIdForUpdate(tx, proposal.plannedWorkoutId);
      if (!workout) throw notFound('Planned workout');
      if (workout.version !== proposal.plannedWorkoutVersion) {
        throw conflict('stale_proposal', 'The workout changed after this proposal was made. Ask for a new analysis.', {
          proposalVersion: proposal.plannedWorkoutVersion,
          currentVersion: workout.version,
        });
      }
      if (workout.date <= today) throw conflict('workout_in_past', 'This workout is no longer in the future.');

      const change = proposedChangeSchema.parse(proposal.proposedChange);
      const shapeError = validateChangeShape(proposal.changeType, change);
      if (shapeError) throw badRequest(shapeError);
      const next = applyProposedChange(workoutFields(workout), proposal.changeType, change);
      if (next.date <= today) throw conflict('workout_in_past', 'The proposed date is not in the future.');

      const updated = await plannedWorkoutsRepo.updateIfVersion(tx, workout.id, workout.version, next);
      if (!updated) throw conflict('stale_proposal', 'The workout was modified concurrently.');

      const decided = await proposalsRepo.update(tx, proposal.id, { status: 'accepted', decidedBy: actor.id, decidedAt: deps.now() });
      await auditRepo.append(tx, {
        actorType: 'athlete',
        actorId: actor.id,
        action: 'proposal.accepted',
        entityType: 'proposal',
        entityId: proposal.id,
        before: { status: proposal.status },
        after: { status: 'accepted' },
        metadata: { note: note ?? null, agentRunId: proposal.agentRunId },
      });
      await auditRepo.append(tx, {
        actorType: 'athlete',
        actorId: actor.id,
        action: 'plan.updated',
        entityType: 'planned_workout',
        entityId: workout.id,
        before: snapshot(workout),
        after: snapshot(updated),
        metadata: { proposalId: proposal.id, changeType: proposal.changeType },
      });
      return decided;
    });
    return result;
  },

  /** Athlete rejects: the plan is left untouched. */
  async reject(deps: ProposalDeps, actor: Actor, id: string, note?: string): Promise<ProposalRow> {
    return deps.db.transaction(async (tx) => {
      const proposal = await lockOwnPending(tx, actor, id);
      const decided = await proposalsRepo.update(tx, proposal.id, { status: 'rejected', decidedBy: actor.id, decidedAt: deps.now() });
      await auditRepo.append(tx, {
        actorType: 'athlete',
        actorId: actor.id,
        action: 'proposal.rejected',
        entityType: 'proposal',
        entityId: proposal.id,
        before: { status: proposal.status },
        after: { status: 'rejected' },
        metadata: { note: note ?? null },
      });
      return decided;
    });
  },

  /** Coach releases a proposal to the athlete (optionally edited) or rejects it before the athlete sees it. */
  async coachReview(deps: ProposalDeps, actor: Actor, id: string, review: CoachReviewRequest): Promise<ProposalRow> {
    requireCoach(actor);
    return deps.db.transaction(async (tx) => {
      const proposal = await proposalsRepo.getByIdForUpdate(tx, id);
      if (!proposal) throw notFound('Proposal');
      const owner = await proposalsRepo.getWorkoutOwnerTeam(tx, proposal.plannedWorkoutId);
      if (!owner || owner.teamId !== actor.teamId) throw notFound('Proposal');
      if (proposal.status !== 'awaiting_coach') throw conflict('not_awaiting_coach', `Proposal is ${proposal.status}, not awaiting coach review.`);

      if (review.action === 'reject') {
        const decided = await proposalsRepo.update(tx, id, { status: 'rejected', coachNote: review.note ?? null, decidedBy: actor.id, decidedAt: deps.now() });
        await auditRepo.append(tx, {
          actorType: 'coach', actorId: actor.id, action: 'proposal.coach_rejected', entityType: 'proposal', entityId: id,
          before: { status: proposal.status }, after: { status: 'rejected' }, metadata: { note: review.note ?? null },
        });
        return decided;
      }

      let change: ProposedChange = proposedChangeSchema.parse(proposal.proposedChange);
      const edited = review.edit !== undefined;
      if (review.edit) change = { ...change, ...review.edit };
      const shapeError = validateChangeShape(proposal.changeType, change);
      if (shapeError) throw badRequest(shapeError);

      const decided = await proposalsRepo.update(tx, id, { status: 'pending', proposedChange: change, coachNote: review.note ?? null });
      await auditRepo.append(tx, {
        actorType: 'coach', actorId: actor.id, action: edited ? 'proposal.coach_edited' : 'proposal.coach_approved', entityType: 'proposal', entityId: id,
        before: { status: proposal.status, proposedChange: proposal.proposedChange }, after: { status: 'pending', proposedChange: change }, metadata: { note: review.note ?? null },
      });
      return decided;
    });
  },

  /** Status a new proposal starts in, given the team's review setting. Used by the agent in Phase 3. */
  async initialStatusFor(db: Db, teamId: string): Promise<'pending' | 'awaiting_coach'> {
    const team = await teamsRepo.get(db, teamId);
    return team?.coachReviewEnabled ? 'awaiting_coach' : 'pending';
  },
};

async function lockOwnPending(tx: Db, actor: Actor, id: string): Promise<ProposalRow> {
  const proposal = await proposalsRepo.getByIdForUpdate(tx, id);
  // Only the owner decides; anyone else (including the coach) gets the same answer as for a missing proposal.
  if (!proposal || proposal.userId !== actor.id || proposal.status === 'awaiting_coach') throw notFound('Proposal');
  if (proposal.status !== 'pending') throw conflict('already_decided', `Proposal is already ${proposal.status}.`);
  return proposal;
}
