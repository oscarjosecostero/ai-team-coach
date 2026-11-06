/**
 * Fixture for the Playwright happy path (web/e2e). Seeds `coach_e2e` and creates one proposal for
 * Carlos by running the REAL agent loop, tools and guarded write path with a scripted model (no
 * API key needed), so the proposal, its evidence and its audit entry are exactly what production
 * code produces. Run: tsx test/e2e/seed-e2e.ts
 */
import { ensureMigratedDatabase } from '../../src/db/migrate.js';
import { createDb } from '../../src/db/client.js';
import { toIsoDate, weekStartOf } from '../../src/domain/dates.js';
import { truncateAllData } from '../../src/repositories/maintenance.js';
import { runAgentForAthlete } from '../../src/services/analysis.js';
import { seedDemoTeam } from '../../src/services/seed.js';
import { lastToolResults, reply, ScriptedLlm, toolCalls, workoutFrom } from '../helpers/fake-llm.js';

const base = process.env.E2E_BASE_DATABASE_URL ?? 'postgres://coach:coach@localhost:5432/coach';
const url = await ensureMigratedDatabase(base, process.env.E2E_DB_NAME ?? 'coach_e2e');
const { db, sql } = createDb(url);
const today = toIsoDate(new Date());
const week = weekStartOf(today);

try {
  await truncateAllData(db);
  const seeded = await seedDemoTeam(db, { today, password: process.env.SEED_PASSWORD ?? 'demo-password' });
  const carlos = seeded.athletes.find((a) => a.name.startsWith('Carlos'))!;

  const isIntervals = (w: { workoutType: string; isFuture?: boolean }) => w.workoutType === 'intervals';
  const llm = new ScriptedLlm([
    () => toolCalls({ name: 'get_week_summary', input: {} }, { name: 'get_calendar', input: {} }),
    (req) => {
      const w = workoutFrom(req, isIntervals);
      return toolCalls({
        name: 'create_proposal',
        input: {
          workoutId: w.workoutId,
          changeType: 'reduce',
          change: { durationMin: Math.round((w.durationMin * 0.75) / 5) * 5, description: 'Same session, fewer repetitions, all in control.' },
          reason: 'Three hard days in a row and a rising resting heart rate: a shorter interval session lets you absorb the work.',
          evidenceFactIds: [`wk:${week}:max_consecutive_hard_days`, `wk:${week}:resting_hr_delta`, `wk:${week}:acwr`],
          confidence: 0.8,
        },
      });
    },
    (req) => {
      const [r] = lastToolResults(req);
      if (!r || r.isError) throw new Error(`fixture proposal rejected: ${JSON.stringify(r?.body)}`);
      return reply(`Three hard days in a row [[wk:${week}:max_consecutive_hard_days]] and resting HR up [[wk:${week}:resting_hr_delta]]: I proposed a shorter interval session.`)(req);
    },
  ]);

  const { result } = await runAgentForAthlete({ db, now: () => new Date(), llm, embeddings: null }, { athleteId: carlos.id, kind: 'weekly', trigger: 'e2e-fixture', userMessage: 'Weekly review.' });
  if (result.status !== 'succeeded' || result.proposalIds.length !== 1) throw new Error(`fixture run failed: ${JSON.stringify(result.error)}`);
  console.log(`e2e fixture ready: ${url.replace(/\/\/[^@]+@/, '//***@')} (today ${today}, proposal ${result.proposalIds[0]})`);
} finally {
  await sql.end();
}
