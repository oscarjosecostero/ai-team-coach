import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LlmError, type LlmClient, type LlmRequest } from '../../src/ai/llm-client.js';
import { buildApp } from '../../src/app.js';
import { chatMessages, knowledgeChunks, proposals, teams } from '../../src/db/schema.js';
import { EmbeddingError, type EmbeddingProvider } from '../../src/integrations/embeddings/embedding-provider.js';
import { handlePostActivityAnalysis, handleRecomputeMetrics, handleWeeklyReviewAll } from '../../src/jobs/handlers.js';
import { checkinsRepo } from '../../src/repositories/checkins.js';
import { knowledgeRepo } from '../../src/repositories/knowledge.js';
import { truncateAllData } from '../../src/repositories/maintenance.js';
import { backfillEmbeddings, searchAthleteNotes } from '../../src/services/notes-search.js';
import { seedDemoTeam, type SeedResult } from '../../src/services/seed.js';
import { createTestApp, loginCookie, PASSWORD, TODAY } from '../helpers/app.js';
import { call, lastToolResults, reply, ScriptedLlm, toolCalls, workoutFrom } from '../helpers/fake-llm.js';

/** Lets each test swap the script while the app keeps one LlmClient. */
const llm: LlmClient & { script: ScriptedLlm | null } = {
  script: null,
  create(req: LlmRequest) {
    if (!this.script) throw new Error('no script set');
    return this.script.create(req);
  },
};

const { app, database, db } = createTestApp({ llm });
const now = () => new Date(`${TODAY}T12:00:00Z`);
let seeded: SeedResult;
let carlos: SeedResult['athletes'][number];
let marcos: SeedResult['athletes'][number];
let carlosCookie: string;
let coachCookie: string;

beforeAll(async () => {
  await truncateAllData(db);
  seeded = await seedDemoTeam(db, { today: TODAY, password: PASSWORD });
  carlos = seeded.athletes.find((a) => a.name.startsWith('Carlos'))!;
  marcos = seeded.athletes.find((a) => a.name.startsWith('Marcos'))!;
  carlosCookie = await loginCookie(app, carlos.email);
  coachCookie = await loginCookie(app, seeded.coach.email);
});
beforeEach(async () => {
  llm.script = null;
  await db.delete(proposals);
  await db.delete(chatMessages);
  await db.update(teams).set({ coachReviewEnabled: false });
});
afterAll(async () => {
  await app.close();
  await database.sql.end();
});

const post = (url: string, cookie: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: { cookie }, payload: payload as object | undefined });
const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });

/** POST /analysis/run answers 202 at once; poll the run like the web client does. */
async function analyze(cookie: string, payload: object = {}) {
  const res = await post('/analysis/run', cookie, payload);
  expect(res.statusCode).toBe(202);
  const id: string = res.json().run.id;
  for (let i = 0; i < 200; i++) {
    const run = (await get(`/analysis/runs/${id}`, cookie)).json().run;
    if (run.status !== 'running') return run;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`run ${id} did not finish`);
}

const reduceThursday = (req: LlmRequest) =>
  toolCalls({
    name: 'create_proposal',
    input: {
      workoutId: workoutFrom(req, (w) => w.date === '2026-11-12').workoutId,
      changeType: 'reduce',
      change: { durationMin: 45 },
      reason: 'Three hard days in a row, so Thursday should be shorter.',
      evidenceFactIds: ['wk:2026-11-02:max_consecutive_hard_days'],
      confidence: 0.8,
    },
  });

describe('POST /chat', () => {
  it('answers from tool data, resolves citations to backend values and drops unknown ones', async () => {
    llm.script = new ScriptedLlm([call('get_week_summary'), reply('Your load ratio is [[wk:2026-11-02:acwr]] and your VO2max is [[wk:2026-11-02:vo2max]].')]);
    const res = await post('/chat', carlosCookie, { message: 'Am I ready for my triathlon?' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.message.content).toBe('Your load ratio is [[wk:2026-11-02:acwr]] and your VO2max is.');
    expect(body.message.citations).toHaveLength(1);
    expect(body.message.citations[0]).toMatchObject({ id: 'wk:2026-11-02:acwr', label: 'Acute:chronic load ratio' });
    expect(typeof body.message.citations[0].value).toBe('number');
    // Chat runs on the Sonnet profile, with the chat instructions appended to the system prompt.
    expect(llm.script.requests[0]!.profile.model).toBe('claude-sonnet-5-5');
    expect(llm.script.requests[0]!.system.at(-1)!.text).toMatch(/chatting with the athlete/);

    const history = await get('/chat', carlosCookie);
    expect(history.json().messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(history.json().messages[1].citations[0].id).toBe('wk:2026-11-02:acwr');
  });

  it('sends earlier turns as history on the next message', async () => {
    llm.script = new ScriptedLlm([reply('First answer.')]);
    await post('/chat', carlosCookie, { message: 'First question' });
    llm.script = new ScriptedLlm([reply('Second answer.')]);
    await post('/chat', carlosCookie, { message: 'Second question' });
    expect(llm.script.requests[0]!.messages).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer.' },
      { role: 'user', content: 'Second question' },
    ]);
  });

  it('is for athletes only, and returns 502 (keeping the question) when the agent fails', async () => {
    expect((await post('/chat', coachCookie, { message: 'hi' })).statusCode).toBe(403);
    llm.script = new ScriptedLlm(() => toolCalls({ name: 'get_history', input: {} }));
    const res = await post('/chat', carlosCookie, { message: 'Loop forever' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('ai_failed');
    const rows = await db.select().from(chatMessages);
    expect(rows.map((r) => r.role)).toEqual(['user']);
  });

  it('says when the provider quota is used up instead of asking for an immediate retry', async () => {
    llm.script = new ScriptedLlm(() => {
      throw new LlmError('Quota exceeded', 'rate_limited', true, 429);
    });
    const res = await post('/chat', carlosCookie, { message: 'Am I ready?' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.message).toMatch(/usage limit/);
  });
});

describe('POST /analysis/run', () => {
  it('runs the weekly review for the athlete and returns summary and proposals', async () => {
    llm.script = new ScriptedLlm([() => toolCalls({ name: 'get_week_summary', input: {} }, { name: 'get_calendar', input: {} }), reduceThursday, reply('Easier Thursday proposed.')]);
    const analysis = await analyze(carlosCookie);
    expect(analysis).toMatchObject({ kind: 'weekly', model: 'claude-sonnet-5-5', status: 'succeeded', summary: 'Easier Thursday proposed.' });
    expect(analysis.proposals).toHaveLength(1);
    expect(analysis.proposals[0]).toMatchObject({ athleteName: 'Carlos Ruiz', workout: { date: '2026-11-12' } });
    expect(analysis.proposalIds).toEqual([analysis.proposals[0].id]);
    expect(analysis).not.toHaveProperty('toolTrace');

    const runs = await get('/analysis/runs', carlosCookie);
    expect(runs.json().runs[0]).toMatchObject({ kind: 'weekly', status: 'succeeded', summary: 'Easier Thursday proposed.' });
    expect(runs.json().runs[0]).not.toHaveProperty('toolTrace');
  });

  it('applies the RBAC rules: a coach may run it for a teammate, an athlete only for themselves', async () => {
    expect((await post('/analysis/run', carlosCookie, { athleteId: marcos.id })).statusCode).toBe(403);
    llm.script = new ScriptedLlm([reply('Marcos looks fine.')]);
    const run = await analyze(coachCookie, { athleteId: marcos.id, kind: 'post_activity' });
    expect(run.model).toBe('claude-haiku-5-5');
    // Another athlete cannot read the run, and gets the same 404 as for an unknown ID.
    expect((await get(`/analysis/runs/${run.id}`, carlosCookie)).statusCode).toBe(404);
    expect((await get('/analysis/runs/00000000-0000-4000-8000-000000000000', carlosCookie)).statusCode).toBe(404);
  });

  it('does not start a second run while one is in progress for the same athlete and kind', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const script = new ScriptedLlm([reply('Done.')]);
    llm.script = { create: async (req: LlmRequest) => (await gate, script.create(req)) } as unknown as ScriptedLlm;
    const first = (await post('/analysis/run', carlosCookie, {})).json().run;
    expect(first.status).toBe('running');
    const second = (await post('/analysis/run', carlosCookie, {})).json().run;
    expect(second.id).toBe(first.id);
    release();
    await expect.poll(async () => (await get(`/analysis/runs/${first.id}`, carlosCookie)).json().run.status).toBe('succeeded');
    expect(script.requests).toHaveLength(1);
  });

  it('hides awaiting_coach proposals from the athlete but shows them to the coach', async () => {
    await db.update(teams).set({ coachReviewEnabled: true });
    llm.script = new ScriptedLlm([
      () => toolCalls({ name: 'get_week_summary', input: {} }, { name: 'get_calendar', input: {} }),
      reduceThursday,
      (req) => {
        expect(lastToolResults(req)[0]!.body).toMatchObject({ created: true, status: 'awaiting_coach' });
        return reply('Proposed.')(req);
      },
    ]);
    const run = await analyze(carlosCookie);
    expect(run.proposals).toEqual([]);
    expect(run.proposalIds).toEqual([]);
    expect((await get('/analysis/runs', carlosCookie)).json().runs[0].proposalIds).toEqual([]);
    expect((await db.select().from(proposals))[0]!.status).toBe('awaiting_coach');
    expect((await get(`/analysis/runs/${run.id}`, coachCookie)).json().run.proposals).toHaveLength(1);
    const coachView = await get('/proposals?status=awaiting_coach', coachCookie);
    expect(coachView.json().proposals).toHaveLength(1);
  });

  it('validates the body', async () => {
    expect((await post('/analysis/run', carlosCookie, { kind: 'monthly' })).statusCode).toBe(400);
  });
});

describe('without ANTHROPIC_API_KEY', () => {
  it('answers 503 on AI routes while the rest of the API keeps working', async () => {
    const plain = buildApp({ database, jobs: { enqueueMetricsRecompute: async () => {}, enqueuePostActivityAnalysis: async () => {} }, now, jwtSecret: 'test-secret-test-secret' });
    try {
      const cookie = await loginCookie(plain, carlos.email);
      const run = await plain.inject({ method: 'POST', url: '/analysis/run', headers: { cookie }, payload: {} });
      expect(run.statusCode).toBe(503);
      expect(run.json().error.code).toBe('ai_unavailable');
      expect((await plain.inject({ method: 'POST', url: '/chat', headers: { cookie }, payload: { message: 'hi' } })).statusCode).toBe(503);
      expect((await plain.inject({ method: 'GET', url: '/dashboard', headers: { cookie } })).statusCode).toBe(200);
    } finally {
      await plain.close();
    }
  });
});

/** Deterministic "semantic" vectors: one dimension per topic, so "joints" is close to "knee". */
class TopicEmbeddings implements EmbeddingProvider {
  readonly model = 'fake-topics-v1';
  readonly dimensions = 1024;
  calls = 0;
  async embed(texts: string[]): Promise<number[][]> {
    this.calls++;
    return texts.map((t) => {
      const v: number[] = new Array<number>(this.dimensions).fill(0);
      if (/knee|joint/i.test(t)) v[0] = 1;
      if (/sleep|slept|tired/i.test(t)) v[1] = 1;
      if (!v.some((x) => x !== 0)) v[2] = 1;
      return v;
    });
  }
}

describe('search_notes (hybrid pgvector + full-text)', () => {
  beforeAll(async () => {
    await checkinsRepo.upsert(db, { userId: carlos.id, date: '2026-11-04', restingHr: 55, sleepHours: 7, fatigue: 3, soreness: 2, note: 'Knee feels a bit off after the long run.' });
    const row = (await checkinsRepo.listRange(db, carlos.id, '2026-11-04', '2026-11-04'))[0]!;
    await knowledgeRepo.upsertNote(db, { userId: carlos.id, sourceType: 'checkin_note', sourceId: row.id, content: row.note! });
  });

  it('finds a note by meaning when no keyword matches, and backfills embeddings', async () => {
    const embeddings = new TopicEmbeddings();
    const { hits, mode } = await searchAthleteNotes({ db, embeddings }, carlos.id, 'joints', 3);
    expect(mode).toBe('hybrid');
    expect(hits[0]).toMatchObject({ content: 'Knee feels a bit off after the long run.', date: '2026-11-04', matchedBy: ['semantic'] });
    const stored = await db.select().from(knowledgeChunks).where(eq(knowledgeChunks.userId, carlos.id));
    expect(stored.every((c) => c.embeddingModel === 'fake-topics-v1')).toBe(true);
    // Nothing left to embed: a second search only embeds the query.
    expect(await backfillEmbeddings({ db, embeddings }, { userId: carlos.id })).toBe(0);
  });

  it('ranks notes matching both ways first', async () => {
    const { hits } = await searchAthleteNotes({ db, embeddings: new TopicEmbeddings() }, carlos.id, 'knee', 3);
    expect(hits[0]).toMatchObject({ content: 'Knee feels a bit off after the long run.', matchedBy: ['text', 'semantic'] });
  });

  it('falls back to full-text when the embedding provider fails', async () => {
    const broken: EmbeddingProvider = { model: 'x', dimensions: 1024, embed: async () => { throw new EmbeddingError('429 rate limited', true); } };
    const { hits, mode } = await searchAthleteNotes({ db, embeddings: broken }, carlos.id, 'knee pain', 3);
    expect(mode).toBe('text');
    expect(hits[0]!.content).toMatch(/Knee feels/);
    expect((await searchAthleteNotes({ db, embeddings: broken }, carlos.id, 'joints', 3)).hits).toEqual([]);
  });

  it('is exposed to the agent as note facts it can cite', async () => {
    llm.script = new ScriptedLlm([
      call('search_notes', { query: 'knee' }),
      (req) => {
        const [r] = lastToolResults(req);
        const results = r!.body.results as { facts: { id: string; value: string }[] }[];
        expect(results[0]!.facts[0]!.id).toMatch(/^note:[0-9a-f]{8}$/);
        return reply(`You mentioned your knee [[${results[0]!.facts[0]!.id}]].`)(req);
      },
    ]);
    const res = await post('/chat', carlosCookie, { message: 'Anything about my knee?' });
    expect(res.json().message.citations[0].value).toBe('Knee feels a bit off after the long run.');
  });
});

describe('analysis jobs', () => {
  it('chains metrics -> post-activity analysis for uploads', async () => {
    const enqueued: string[] = [];
    await handleRecomputeMetrics({ db, now, publisher: { enqueuePostActivityAnalysis: async (id) => void enqueued.push(id) } }, { userId: carlos.id, fromWeekStart: '2026-11-02', thenAnalyze: true });
    await handleRecomputeMetrics({ db, now, publisher: { enqueuePostActivityAnalysis: async (id) => void enqueued.push(id) } }, { userId: carlos.id, fromWeekStart: '2026-11-02' });
    expect(enqueued).toEqual([carlos.id]);
  });

  it('debounces post-activity analysis to one successful run per athlete per day', async () => {
    const script = new ScriptedLlm(() => reply('Looks fine.')({} as LlmRequest));
    const ana = seeded.athletes.find((a) => a.name.startsWith('Ana'))!;
    const first = await handlePostActivityAnalysis({ db, now, llm: script }, { userId: ana.id });
    expect(first).toMatchObject({ status: 'succeeded' });
    expect(await handlePostActivityAnalysis({ db, now, llm: script }, { userId: ana.id })).toEqual({ skipped: 'already_analyzed_today' });
    expect(await handlePostActivityAnalysis({ db, now, llm: null }, { userId: carlos.id })).toEqual({ skipped: 'no_llm' });
    await expect(handlePostActivityAnalysis({ db, now, llm: script }, { userId: 'not-a-uuid' })).rejects.toThrow();
  });

  it('runs the weekly review for every athlete', async () => {
    const script = new ScriptedLlm(() => reply('Weekly summary.')({} as LlmRequest));
    expect(await handleWeeklyReviewAll({ db, now, llm: script })).toEqual({ succeeded: 5, failed: 0 });
    expect(script.requests.every((r) => r.profile.model === 'claude-sonnet-5-5')).toBe(true);
  });
});

describe('UI-facing enrichments', () => {
  it('returns proposals with the target workout and athlete name, calendar weeks and run citations', async () => {
    llm.script = new ScriptedLlm([() => toolCalls({ name: 'get_week_summary', input: {} }, { name: 'get_calendar', input: {} }), reduceThursday, reply('Shorter Thursday [[wk:2026-11-02:max_consecutive_hard_days]].')]);
    await analyze(carlosCookie);

    const { proposals: list } = (await get('/proposals?status=pending', carlosCookie)).json();
    expect(list[0]).toMatchObject({ athleteName: 'Carlos Ruiz', workout: { date: '2026-11-12', workoutType: 'intervals', durationMin: 60, plannedLoad: 240, version: 1 } });
    // The backend also returns the workout as it would be after the change, both with their intensity profile.
    expect(list[0].proposed).toMatchObject({ date: '2026-11-12', workoutType: 'intervals', durationMin: 45 });
    expect(list[0].proposed.plannedLoad).toBeLessThan(240);
    for (const w of [list[0].workout, list[0].proposed]) expect(w.shape.reduce((s: number, b: { minutes: number }) => s + b.minutes, 0)).toBe(w.durationMin);

    const cal = (await get('/calendar?from=2026-11-07&to=2026-11-15', carlosCookie)).json();
    expect(cal.workouts.every((w: { shape: unknown[]; workoutType: string }) => Array.isArray(w.shape) && (w.workoutType === 'rest') === (w.shape.length === 0))).toBe(true);
    expect(cal.weeks).toEqual([
      { weekStart: '2026-11-02', plannedLoad: 480 },
      { weekStart: '2026-11-09', plannedLoad: 1041 },
    ]);

    const dash = (await get('/dashboard', carlosCookie)).json();
    expect(dash.daysToRace).toBe(37);

    const runs = (await get('/analysis/runs', carlosCookie)).json().runs;
    expect(runs[0].citations[0]).toMatchObject({ id: 'wk:2026-11-02:max_consecutive_hard_days' });
    expect(runs[0].proposalIds).toHaveLength(1);
  });
});
