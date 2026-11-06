import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../../src/ai/tools/registry.js';
import type { LlmRequest } from '../../src/ai/llm-client.js';
import { agentRuns, auditLog, plannedWorkouts, proposals, teams, weeklyMetrics } from '../../src/db/schema.js';
import { PROFESSIONAL_REFERRAL } from '../../src/domain/injury-signal.js';
import { checkinsRepo } from '../../src/repositories/checkins.js';
import { createAgentProposal } from '../../src/services/agent-proposals.js';
import { truncateAllData } from '../../src/repositories/maintenance.js';
import { runAgentForAthlete, runAnalysis, type AiDeps } from '../../src/services/analysis.js';
import { seedDemoTeam, type SeedResult } from '../../src/services/seed.js';
import { createTestDb } from '../helpers/db.js';
import { allToolResults, call, lastToolResults, refusal, reply, ScriptedLlm, toolCalls, workoutFrom, type Step } from '../helpers/fake-llm.js';
import { PASSWORD, TODAY } from '../helpers/app.js';

const database = createTestDb();
const db = database.db;
const now = () => new Date(`${TODAY}T12:00:00Z`);
let seeded: SeedResult;
let carlos: SeedResult['athletes'][number];
let lucia: SeedResult['athletes'][number];

// Carlos' plan for the week of 2026-11-09 (backend planned load, TRIMP units):
// Tue tempo 175 + Wed swim 90 + Thu intervals 240 + Fri strength 56 + Sat ride 300 + Sun run 180 = 1041.
const THURSDAY = '2026-11-12';
const isThursdayIntervals = (w: { date: string }) => w.date === THURSDAY;

beforeEach(async () => {
  await truncateAllData(db);
  seeded = await seedDemoTeam(db, { today: TODAY, password: PASSWORD });
  carlos = seeded.athletes.find((a) => a.name.startsWith('Carlos'))!;
  lucia = seeded.athletes.find((a) => a.name.startsWith('Lucía'))!;
});
afterAll(async () => {
  await database.sql.end();
});

const deps = (llm: ScriptedLlm, over: Partial<AiDeps> = {}): AiDeps => ({ db, now, llm, embeddings: null, ...over });
const planSnapshot = () => db.select().from(plannedWorkouts).orderBy(asc(plannedWorkouts.id));
const run = (llm: ScriptedLlm, athleteId = carlos.id, kind: 'weekly' | 'post_activity' = 'weekly') =>
  runAgentForAthlete(deps(llm), { athleteId, kind, trigger: 'test', userMessage: 'Review the week.' });

/** get_week_summary + get_calendar in one turn, then whatever follows. */
const look: Step = () => toolCalls({ name: 'get_week_summary', input: {} }, { name: 'get_calendar', input: {} });

const proposeThursday =
  (changeType: string, change: Record<string, unknown>, evidenceFactIds = ['wk:2026-11-02:max_consecutive_hard_days'], extra: Record<string, unknown> = {}): Step =>
  (req: LlmRequest) =>
    toolCalls({
      name: 'create_proposal',
      input: {
        workoutId: workoutFrom(req, isThursdayIntervals).workoutId,
        changeType,
        change,
        reason: 'Three hard days in a row and resting HR is rising, so Thursday should be easier.',
        evidenceFactIds,
        confidence: 0.8,
        ...extra,
      },
    });

describe('agent: tool allowlist and prompt', () => {
  it('sends exactly the five allowlisted tools with cache breakpoints on the stable prefix', async () => {
    const llm = new ScriptedLlm([reply('All good this week.')]);
    const { result } = await run(llm);
    expect(result.status).toBe('succeeded');

    const req = llm.requests[0]!;
    expect(req.tools.map((t) => t.name)).toEqual(['get_week_summary', 'get_history', 'get_calendar', 'search_notes', 'create_proposal']);
    expect(TOOL_NAMES.filter((n) => !n.startsWith('get_') && n !== 'search_notes')).toEqual(['create_proposal']);
    for (const t of req.tools) expect(t.input_schema).not.toHaveProperty('$schema');
    expect(req.system).toHaveLength(2);
    expect(req.system.every((b) => b.cache_control?.type === 'ephemeral')).toBe(true);
    expect(req.system[1]!.text).toContain('Carlos Ruiz');
    expect(req.system[1]!.text.trim().endsWith(`Today is ${TODAY}.`)).toBe(true);
    // The static block must not vary per athlete or day, or it would not cache across runs.
    expect(req.system[0]!.text).not.toContain('Carlos');
    expect(req.system[0]!.text).not.toContain(TODAY);
  });

  it('refuses a tool that is not on the allowlist and leaves the plan untouched', async () => {
    const before = await planSnapshot();
    const llm = new ScriptedLlm([
      look,
      (req) => toolCalls({ name: 'update_planned_workout', input: { workoutId: workoutFrom(req, isThursdayIntervals).workoutId, durationMin: 30 } }),
      (req) => {
        const [r] = lastToolResults(req);
        expect(r!.isError).toBe(true);
        expect(String(r!.body.error)).toMatch(/Unknown tool "update_planned_workout"/);
        return reply('I cannot edit the plan directly.')(req);
      },
    ]);
    const { result } = await run(llm);
    expect(result.status).toBe('succeeded');
    expect(result.trace.filter((s) => s.type === 'tool' && s.tool === 'update_planned_workout').every((s) => s.type === 'tool' && s.isError)).toBe(true);
    expect(await planSnapshot()).toEqual(before);
    expect(await db.select().from(proposals)).toHaveLength(0);
  });

  it('suggests the exact name for a near-miss tool name', async () => {
    const llm = new ScriptedLlm([
      call('Get_Week_Summary'),
      (req) => {
        expect(lastToolResults(req)[0]!.body.error).toMatch(/Did you mean "get_week_summary"/);
        return reply('ok')(req);
      },
    ]);
    expect((await run(llm)).result.status).toBe('succeeded');
  });
});

describe('agent: validation of model output', () => {
  it('rejects invalid tool input and lets the model self-correct', async () => {
    const llm = new ScriptedLlm([
      look,
      // Wrong enum, missing evidence, confidence out of range, unknown field.
      (req) => toolCalls({ name: 'create_proposal', input: { workoutId: workoutFrom(req, isThursdayIntervals).workoutId, changeType: 'shorten', change: {}, reason: 'short', confidence: 3, extra: true } }),
      (req) => {
        const [r] = lastToolResults(req);
        expect(r!.isError).toBe(true);
        const paths = (r!.body.issues as { path: string }[]).map((i) => i.path);
        expect(paths).toEqual(expect.arrayContaining(['changeType', 'reason', 'evidenceFactIds', 'confidence']));
        // Valid JSON, wrong shape for the change type: reduce without a duration.
        return proposeThursday('reduce', { description: 'easier' })(req);
      },
      (req) => {
        expect(lastToolResults(req)[0]!.body.error).toMatch(/reduce requires durationMin/);
        return proposeThursday('reduce', { durationMin: 45 })(req);
      },
      (req) => {
        expect(lastToolResults(req)[0]!.body.created).toBe(true);
        return reply('Proposed a shorter Thursday session.')(req);
      },
    ]);
    const { result } = await run(llm);
    expect(result.status).toBe('succeeded');
    expect(result.proposalIds).toHaveLength(1);
    expect(await db.select().from(proposals)).toHaveLength(1);
  });

  it('rejects unknown fact IDs and stores backend values for the cited ones', async () => {
    const llm = new ScriptedLlm([
      look,
      // A made-up metric, and a real-looking ID for a week this run never fetched.
      proposeThursday('reduce', { durationMin: 45 }, ['wk:2026-11-02:vo2max', 'wk:2026-09-07:total_load', 'wk:2026-11-02:acwr']),
      (req) => {
        const [r] = lastToolResults(req);
        expect(r!.isError).toBe(true);
        expect(r!.body.unknownFactIds).toEqual(['wk:2026-11-02:vo2max', 'wk:2026-09-07:total_load']);
        return proposeThursday('reduce', { durationMin: 45 }, ['wk:2026-11-02:acwr', 'wk:2026-11-02:max_consecutive_hard_days', 'chk:2026-11-06:resting_hr'])(req);
      },
      reply('Done.'),
    ]);
    const { result } = await run(llm);
    expect(result.proposalIds).toHaveLength(1);

    const [p] = await db.select().from(proposals);
    const [week] = await db.select().from(weeklyMetrics).where(eq(weeklyMetrics.weekStart, '2026-11-02')).then((r) => r.filter((x) => x.userId === carlos.id));
    const evidence = p!.evidence as { id: string; value: unknown; source: string }[];
    expect(evidence.find((f) => f.id === 'wk:2026-11-02:acwr')).toMatchObject({ value: week!.acwr, source: 'cited' });
    expect(evidence.find((f) => f.id === 'wk:2026-11-02:max_consecutive_hard_days')!.value).toBe(week!.maxConsecutiveHardDays);
    // The backend adds the load impact itself, so the UI shows computed numbers, not model text.
    expect(evidence.find((f) => f.id === 'impact:2026-11-09:planned_load_before')).toMatchObject({ value: 1041, source: 'computed' });
    expect(evidence.find((f) => f.id === 'impact:2026-11-09:planned_load_after')!.value).toBe(981);
  });

  it('only accepts workout IDs the model saw in get_calendar for this athlete', async () => {
    const luciaWorkout = (await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.userId, lucia.id)))[3]!;
    const llm = new ScriptedLlm([
      call('get_week_summary'),
      () =>
        toolCalls({
          name: 'create_proposal',
          input: { workoutId: luciaWorkout.id, changeType: 'rest', change: {}, reason: 'Trying to touch another athlete plan here.', evidenceFactIds: ['signal:injury'], confidence: 0.5 },
        }),
      (req) => {
        expect(lastToolResults(req)[0]!.body.error).toMatch(/Unknown workoutId/);
        return reply('ok')(req);
      },
    ]);
    await run(llm);
    expect(await db.select().from(proposals)).toHaveLength(0);

    // Defense in depth: the write path itself refuses another athlete's workout.
    const direct = await createAgentProposal(
      { db, now },
      { athleteId: carlos.id, agentRunId: (await run(new ScriptedLlm([reply('x')]))).run.id, workoutId: luciaWorkout.id, changeType: 'rest', change: {}, reason: 'x'.repeat(30), citedFacts: [], confidence: 0.5, modelInjuryConcern: false },
    );
    expect(direct).toMatchObject({ ok: false, code: 'not_found' });
    expect(await db.select().from(proposals)).toHaveLength(0);
  });

  it('caps proposals per run', async () => {
    const llm = new ScriptedLlm([
      look,
      proposeThursday('reduce', { durationMin: 45 }),
      (req) =>
        toolCalls({
          name: 'create_proposal',
          input: { workoutId: workoutFrom(req, (w) => w.date === '2026-11-10').workoutId, changeType: 'reduce', change: { durationMin: 45 }, reason: 'A second change that should be refused by the cap.', evidenceFactIds: ['signal:injury'], confidence: 0.5 },
        }),
      (req) => {
        expect(lastToolResults(req)[0]!.body.error).toMatch(/at most 1 proposal/);
        return reply('ok')(req);
      },
    ]);
    const { result } = await run(llm, carlos.id, 'post_activity');
    expect(result.proposalIds).toHaveLength(1);
  });
});

describe('agent: guardrails at the write boundary', () => {
  it('enforces the ±10% weekly planned-load rule, then accepts a compliant change', async () => {
    const before = await planSnapshot();
    const llm = new ScriptedLlm([
      look,
      // 60 min intervals (240) -> 40 min easy (80): week 1041 -> 881 = -15.4%.
      proposeThursday('replace', { workoutType: 'easy', title: 'Easy run', durationMin: 40, sport: 'run' }),
      (req) => {
        const [r] = lastToolResults(req);
        expect(r!.isError).toBe(true);
        expect(r!.body.code).toBe('guardrail_violation');
        expect(r!.body.plannedLoadImpact).toEqual([{ weekStart: '2026-11-09', before: 1041, after: 881, changePct: -15.4, allowedMin: 936.9, allowedMax: 1145.1 }]);
        // 75 min easy (150): 1041 -> 951 = -8.6%, inside the range.
        return proposeThursday('replace', { workoutType: 'easy', title: 'Easy run', durationMin: 75, sport: 'run' })(req);
      },
      reply('Swapped Thursday intervals for an easy run.'),
    ]);
    const { run: agentRun, result } = await run(llm);
    expect(result.status).toBe('succeeded');

    const rows = await db.select().from(proposals);
    expect(rows).toHaveLength(1);
    const thursday = before.find((w) => w.userId === carlos.id && w.date === THURSDAY)!;
    expect(rows[0]).toMatchObject({ status: 'pending', changeType: 'replace', plannedWorkoutId: thursday.id, plannedWorkoutVersion: thursday.version, agentRunId: agentRun.id });

    const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, rows[0]!.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: 'agent', actorId: 'coach-agent-v1', action: 'proposal.created' });
    // The agent proposes; the plan only changes when a human accepts.
    expect(await planSnapshot()).toEqual(before);
  });

  it('rejects a load increase above 10%', async () => {
    const llm = new ScriptedLlm([
      look,
      // Wed easy swim 45 (90) -> 90 min intervals (360): 1041 -> 1311 = +25.9%.
      (req) =>
        toolCalls({
          name: 'create_proposal',
          input: { workoutId: workoutFrom(req, (w) => w.date === '2026-11-11').workoutId, changeType: 'replace', change: { workoutType: 'intervals', title: 'Big swim set', durationMin: 90 }, reason: 'More intensity would help build race-specific fitness.', evidenceFactIds: ['wk:2026-11-02:ctl'], confidence: 0.6 },
        }),
      (req) => {
        expect(lastToolResults(req)[0]!.body.violations).toEqual([expect.stringMatching(/week of 2026-11-09: weekly load change 25.9% exceeds ±10%/)]);
        return reply('No change.')(req);
      },
    ]);
    await run(llm);
    expect(await db.select().from(proposals)).toHaveLength(0);
  });

  it('allows only one open proposal per workout', async () => {
    const first = new ScriptedLlm([look, proposeThursday('reduce', { durationMin: 45 }), reply('done')]);
    await run(first);
    const second = new ScriptedLlm([
      look,
      (req) => {
        expect(workoutFrom(req, isThursdayIntervals)).toMatchObject({ hasOpenProposal: true });
        return proposeThursday('reduce', { durationMin: 50 })(req);
      },
      (req) => {
        expect(lastToolResults(req)[0]!.body.violations).toContain('workout already has an open proposal');
        return reply('Already proposed.')(req);
      },
    ]);
    await run(second);
    expect(await db.select().from(proposals)).toHaveLength(1);
  });

  it('starts proposals as awaiting_coach when the team has coach review', async () => {
    await db.update(teams).set({ coachReviewEnabled: true });
    const llm = new ScriptedLlm([look, proposeThursday('reduce', { durationMin: 45 }), reply('done')]);
    await run(llm);
    const [p] = await db.select().from(proposals);
    expect(p!.status).toBe('awaiting_coach');
  });
});

describe('agent: injury path', () => {
  it('detects pain in a check-in note, allows only reduce/rest and appends a professional referral', async () => {
    await checkinsRepo.upsert(db, { userId: carlos.id, date: TODAY, restingHr: 58, sleepHours: 6, fatigue: 4, soreness: 4, note: 'Sharp pain in my left knee going down the stairs.' });
    const llm = new ScriptedLlm([
      look,
      (req) => {
        const summary = allToolResults(req).find((r) => r.body.signals)!.body as { signals: { facts: { id: string; value: string }[] } };
        expect(summary.signals.facts.find((f) => f.id === 'signal:injury')!.value).toMatch(/^detected: check-in note on 2026-11-06/);
        return proposeThursday('replace', { workoutType: 'easy', title: 'Easy run', durationMin: 75 })(req);
      },
      (req) => {
        const [r] = lastToolResults(req);
        expect(r!.body.violations).toContain('injury signal: only reduce or rest is allowed (and recommend a professional)');
        expect(r!.body.allowedChangeTypes).toEqual(['reduce', 'rest']);
        // Rest removes 240 of 1041 (-23%): allowed, because backing off is the point under an injury signal.
        return proposeThursday('rest', {}, ['signal:injury', 'chk:2026-11-06:note'], { injuryConcern: true })(req);
      },
      reply('Rest on Thursday and see a physio.'),
    ]);
    const { result } = await run(llm);
    expect(result.proposalIds).toHaveLength(1);
    const [p] = await db.select().from(proposals);
    expect(p!.changeType).toBe('rest');
    expect(p!.reason.endsWith(PROFESSIONAL_REFERRAL)).toBe(true);
    const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, p!.id));
    expect((audit[0]!.metadata as { injurySignal: { flag: boolean } }).injurySignal.flag).toBe(true);
  });

  it('treats a model-raised injury concern the same way (the model can raise the flag, never lower it)', async () => {
    const llm = new ScriptedLlm([
      look,
      proposeThursday('replace', { workoutType: 'easy', title: 'Easy run', durationMin: 75 }, undefined, { injuryConcern: true }),
      (req) => {
        expect(lastToolResults(req)[0]!.body.violations).toContain('injury signal: only reduce or rest is allowed (and recommend a professional)');
        return reply('ok')(req);
      },
    ]);
    await run(llm);
    expect(await db.select().from(proposals)).toHaveLength(0);
  });
});

describe('agent: failure handling', () => {
  it('fails the run after max turns and records it in agent_runs', async () => {
    const llm = new ScriptedLlm(() => toolCalls({ name: 'get_history', input: { weeks: 4 } }));
    const { run: r, result } = await run(llm, carlos.id, 'post_activity');
    expect(result).toMatchObject({ status: 'failed', error: { code: 'max_turns' } });
    expect(llm.requests).toHaveLength(8);
    const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, r.id));
    expect(row).toMatchObject({ status: 'failed', kind: 'post_activity', model: 'claude-haiku-5-5' });
    expect(row!.error).toMatch(/^max_turns/);
    expect(row!.inputTokens).toBe(8000);
    expect(row!.cacheReadTokens).toBe(6400);
    expect(row!.finishedAt).not.toBeNull();
  });

  it('fails on a refusal without running tools', async () => {
    const llm = new ScriptedLlm([refusal()]);
    const { result } = await run(llm);
    expect(result).toMatchObject({ status: 'failed', error: { code: 'refusal' } });
  });

  it('records a successful post-activity analysis with summary, citations and proposal', async () => {
    const llm = new ScriptedLlm([
      look,
      proposeThursday('reduce', { durationMin: 45 }),
      reply('Third hard day in a row [[wk:2026-11-02:max_consecutive_hard_days]] and a made-up figure [[wk:2026-11-02:vo2max]].'),
    ]);
    const r = await runAnalysis(deps(llm), { athleteId: carlos.id, kind: 'post_activity', trigger: 'test' });
    expect(r.status).toBe('succeeded');
    expect(r.model).toBe('claude-haiku-5-5');
    expect(r.proposals).toHaveLength(1);
    expect(r.summary).toBe('Third hard day in a row [[wk:2026-11-02:max_consecutive_hard_days]] and a made-up figure.');
    expect(r.citations.map((c) => c.id)).toEqual(['wk:2026-11-02:max_consecutive_hard_days']);
    expect(llm.requests[0]!.messages[0]!.content).toMatch(/new run activity was just recorded \(2026-11-06\)/);
  });
});
