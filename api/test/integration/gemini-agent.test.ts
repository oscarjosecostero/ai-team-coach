import { FinishReason, type Content, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GeminiLlmClient } from '../../src/ai/gemini-client.js';
import { agentRuns, proposals } from '../../src/db/schema.js';
import { truncateAllData } from '../../src/repositories/maintenance.js';
import { runAgentForAthlete } from '../../src/services/analysis.js';
import { seedDemoTeam, type SeedResult } from '../../src/services/seed.js';
import { PASSWORD, TODAY } from '../helpers/app.js';
import { createTestDb } from '../helpers/db.js';

/**
 * The real agent loop, tools, fact ledger and guarded write path, with the Gemini adapter in front of
 * a scripted Gemini API. Proves the second provider needs no changes outside ai/gemini-client.ts.
 */
const database = createTestDb();
const db = database.db;
const now = () => new Date(`${TODAY}T12:00:00Z`);
let carlos: SeedResult['athletes'][number];

beforeAll(async () => {
  await truncateAllData(db);
  const seeded = await seedDemoTeam(db, { today: TODAY, password: PASSWORD });
  carlos = seeded.athletes.find((a) => a.name.startsWith('Carlos'))!;
});
afterAll(() => database.sql.end());

const call = (name: string, args: object, thoughtSignature?: string) => ({ functionCall: { name, args }, ...(thoughtSignature ? { thoughtSignature } : {}) });
const turn = (parts: object[]) =>
  ({ candidates: [{ content: { role: 'model', parts }, finishReason: FinishReason.STOP }], usageMetadata: { promptTokenCount: 3000, cachedContentTokenCount: 2000, candidatesTokenCount: 80 } }) as unknown as GenerateContentResponse;
const responses = (contents: Content[]) => contents.at(-1)!.parts!.map((p) => p.functionResponse!).filter(Boolean);

describe('agent loop on the Gemini adapter', () => {
  it('reads data, creates a guarded proposal with backend evidence and cites facts', async () => {
    const seen: GenerateContentParameters[] = [];
    const script = [
      () => turn([call('get_week_summary', {}, 'sig-turn-1'), call('get_calendar', {})]),
      (p: GenerateContentParameters) => {
        const contents = p.contents as Content[];
        // The signature travels back on the model turn; results come back by function name.
        expect(contents[1]!.parts![0]!.thoughtSignature).toBe('sig-turn-1');
        const cal = responses(contents).find((r) => r.name === 'get_calendar')!.response!.output as { workouts: { workoutId: string; date: string }[] };
        const thursday = cal.workouts.find((w) => w.date === '2026-11-12')!;
        return turn([
          call('create_proposal', {
            workoutId: thursday.workoutId,
            changeType: 'reduce',
            change: { durationMin: 45 },
            reason: 'Three hard days in a row and resting HR is rising, so Thursday should be shorter.',
            evidenceFactIds: ['wk:2026-11-02:max_consecutive_hard_days'],
            confidence: 0.8,
          }),
        ]);
      },
      (p: GenerateContentParameters) => {
        const [r] = responses(p.contents as Content[]);
        expect(r).toMatchObject({ name: 'create_proposal', response: { output: { created: true, status: 'pending' } } });
        return turn([{ text: 'Shorter Thursday proposed: [[wk:2026-11-02:max_consecutive_hard_days]] hard days in a row.' }]);
      },
    ];
    const llm = new GeminiLlmClient({ generate: async (p) => (seen.push(p), script[seen.length - 1]!(p)) });

    const { run, result } = await runAgentForAthlete({ db, now, llm, embeddings: null }, { athleteId: carlos.id, kind: 'weekly', trigger: 'test', userMessage: 'Weekly review.' });

    expect(result.status).toBe('succeeded');
    expect(result.citations).toMatchObject([{ id: 'wk:2026-11-02:max_consecutive_hard_days', value: 3 }]);
    const [stored] = await db.select().from(agentRuns).where(eq(agentRuns.id, run.id));
    expect(stored).toMatchObject({ model: 'gemini-2.5-flash', status: 'succeeded', inputTokens: 3000, cacheReadTokens: 6000 });
    const [p] = await db.select().from(proposals).where(eq(proposals.agentRunId, run.id));
    expect(p).toMatchObject({ status: 'pending', changeType: 'reduce' });
    expect((p!.evidence as { source?: string }[]).some((f) => f.source === 'computed')).toBe(true);
  });
});
