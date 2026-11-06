import type { Fact } from '@coach/contracts';
import type { AgentProposalInput, AgentProposalResult } from '../ai/ports.js';
import { AGENT_ACTOR_ID } from '../ai/models.js';
import type { Db } from '../db/client.js';
import { addDays, toIsoDate, weekStartOf } from '../domain/dates.js';
import { detectInjurySignal, PROFESSIONAL_REFERRAL, type InjurySignal } from '../domain/injury-signal.js';
import { checkProposalGuardrails } from '../domain/plan-guardrails.js';
import { proposalLoadImpact, type WeekLoadImpact } from '../domain/plan-load.js';
import { validateChangeShape } from '../domain/proposal-change.js';
import type { Clock } from '../lib/actor.js';
import { activitiesRepo } from '../repositories/activities.js';
import { auditRepo } from '../repositories/audit.js';
import { checkinsRepo } from '../repositories/checkins.js';
import { plannedWorkoutsRepo } from '../repositories/planned-workouts.js';
import { proposalsRepo } from '../repositories/proposals.js';
import { usersRepo } from '../repositories/users.js';
import { proposalService } from './proposals.js';

/** Backend injury rule over the last 7 days of check-ins and activity notes. */
export async function injurySignalFor(db: Db, userId: string, today: string): Promise<InjurySignal> {
  const from = addDays(today, -6);
  const [checkins, activities] = await Promise.all([
    checkinsRepo.listRange(db, userId, from, today),
    activitiesRepo.listBetween(db, userId, new Date(`${from}T00:00:00Z`), new Date(`${today}T23:59:59.999Z`)),
  ]);
  return detectInjurySignal(
    {
      checkins: checkins.map((c) => ({ date: c.date, soreness: c.soreness, note: c.note })),
      activityNotes: activities.filter((a) => a.notes).map((a) => ({ date: toIsoDate(a.startedAt), note: a.notes! })),
    },
    today,
  );
}

function impactFacts(weeks: WeekLoadImpact[]): Fact[] {
  return weeks.flatMap((w) => [
    { id: `impact:${w.weekStart}:planned_load_before`, label: `Planned load, week of ${w.weekStart} (now)`, value: w.before, unit: 'TRIMP', source: 'computed' as const },
    { id: `impact:${w.weekStart}:planned_load_after`, label: `Planned load, week of ${w.weekStart} (if accepted)`, value: w.after, unit: 'TRIMP', source: 'computed' as const },
    { id: `impact:${w.weekStart}:change_pct`, label: `Planned load change, week of ${w.weekStart}`, value: w.changePct, unit: '%', source: 'computed' as const },
  ]);
}

/**
 * The write path behind the agent's create_proposal tool. Everything that makes a proposal safe
 * is decided here, from stored data, inside one transaction that locks the workout row:
 * ownership, future date, one open proposal per workout, the ±10% weekly planned-load rule and
 * the injury rule. Only a proposal is inserted; the plan itself is never touched.
 */
export async function createAgentProposal(deps: { db: Db; now: Clock }, input: AgentProposalInput): Promise<AgentProposalResult> {
  const today = toIsoDate(deps.now());

  return deps.db.transaction(async (tx) => {
    const workout = await plannedWorkoutsRepo.getByIdForUpdate(tx, input.workoutId);
    // Same answer for "missing" and "someone else's": the agent learns nothing about other athletes.
    if (!workout || workout.userId !== input.athleteId) return { ok: false, code: 'not_found', message: 'No such upcoming workout for this athlete.' };

    const shapeError = validateChangeShape(input.changeType, input.change);
    if (shapeError) return { ok: false, code: 'invalid_change', message: shapeError };
    if (workout.workoutType === 'rest' && (input.changeType === 'rest' || input.changeType === 'reduce')) {
      return { ok: false, code: 'invalid_change', message: 'This workout is already a rest day.' };
    }
    if (input.changeType === 'move' && input.change.date === workout.date) {
      return { ok: false, code: 'invalid_change', message: 'move needs a different date.' };
    }

    const target = { ...workout, plannedLoad: workout.plannedLoad };
    const nextDate = input.changeType === 'move' || input.changeType === 'replace' ? (input.change.date ?? workout.date) : workout.date;
    const firstWeek = weekStartOf(nextDate < workout.date ? nextDate : workout.date);
    const lastWeek = weekStartOf(nextDate > workout.date ? nextDate : workout.date);
    const weekWorkouts = await plannedWorkoutsRepo.listRange(tx, input.athleteId, firstWeek, addDays(lastWeek, 6));
    const impact = proposalLoadImpact({ target, changeType: input.changeType, change: input.change, weekWorkouts });

    const backendInjury = await injurySignalFor(tx, input.athleteId, today);
    const injury: InjurySignal = input.modelInjuryConcern
      ? { flag: true, reasons: [...backendInjury.reasons, 'the coach agent flagged a possible injury'] }
      : backendInjury;
    const hasOpen = await proposalsRepo.hasOpenForWorkout(tx, workout.id);

    const violations = new Set<string>();
    if (impact.next.date <= today) violations.add('the new date must be in the future');
    for (const w of impact.weeks) {
      const r = checkProposalGuardrails({
        workoutOwnerId: workout.userId,
        proposerAthleteId: input.athleteId,
        workoutDate: workout.date,
        today,
        currentWeekPlannedLoad: w.before,
        proposedWeekPlannedLoad: w.after,
        changeType: input.changeType,
        injurySignal: injury.flag,
        hasOpenProposalForWorkout: hasOpen,
      });
      if (!r.ok) r.violations.forEach((v) => violations.add(v.startsWith('weekly load change') ? `week of ${w.weekStart}: ${v}` : v));
    }
    if (violations.size) {
      return {
        ok: false,
        code: 'guardrail_violation',
        message: 'The backend rejected this proposal: ' + [...violations].join('; ') + '.',
        violations: [...violations],
        weeks: impact.weeks,
        injury,
      };
    }

    const reason = injury.flag && !input.reason.includes(PROFESSIONAL_REFERRAL) ? `${input.reason.trim()} ${PROFESSIONAL_REFERRAL}` : input.reason.trim();
    const athlete = await usersRepo.findById(tx, input.athleteId);
    const status = await proposalService.initialStatusFor(tx, athlete!.teamId);
    const evidence: Fact[] = [...input.citedFacts.map((f) => ({ ...f, source: 'cited' as const })), ...impactFacts(impact.weeks)];

    const proposal = await proposalsRepo.insert(tx, {
      userId: input.athleteId,
      agentRunId: input.agentRunId,
      plannedWorkoutId: workout.id,
      plannedWorkoutVersion: workout.version,
      changeType: input.changeType,
      proposedChange: input.change,
      reason,
      evidence,
      confidence: Math.round(Math.min(1, Math.max(0, input.confidence)) * 100) / 100,
      status,
    });
    await auditRepo.append(tx, {
      actorType: 'agent',
      actorId: AGENT_ACTOR_ID,
      action: 'proposal.created',
      entityType: 'proposal',
      entityId: proposal.id,
      before: null,
      after: { status, changeType: input.changeType, proposedChange: input.change, plannedWorkoutId: workout.id, plannedWorkoutVersion: workout.version },
      metadata: { agentRunId: input.agentRunId, injurySignal: injury, plannedLoadImpact: impact.weeks },
    });

    return { ok: true, proposal: { id: proposal.id, status, weeks: impact.weeks, injury } };
  });
}
