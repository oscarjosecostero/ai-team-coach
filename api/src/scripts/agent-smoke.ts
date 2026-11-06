import type { Fact } from '@coach/contracts';
import type { TraceStep } from '../ai/coach-agent.js';
import { createAiAdapters } from '../config/ai.js';
import { loadEnv } from '../config/env.js';
import { createDb, type Db } from '../db/client.js';
import { ensureMigratedDatabase } from '../db/migrate.js';
import { toIsoDate } from '../domain/dates.js';
import { agentRunsRepo } from '../repositories/agent-runs.js';
import { truncateAllData } from '../repositories/maintenance.js';
import { plannedWorkoutsRepo } from '../repositories/planned-workouts.js';
import { proposalsRepo, type ProposalRow } from '../repositories/proposals.js';
import { runAgentForAthlete, runAnalysis, type AiDeps, type StoredTrace } from '../services/analysis.js';
import { backfillEmbeddings } from '../services/notes-search.js';
import { seedDemoTeam } from '../services/seed.js';

/**
 * End-to-end check against the real Claude API on the seed scenario (Phase 3 gate):
 *   npm run agent:smoke            (from the repo root or api/)
 * Uses its own database (`coach_smoke`), reseeded on every run, so the dev data is never touched.
 * Costs a few cents: one Haiku post-activity run, one Sonnet weekly review, one Sonnet chat turn.
 */

const SMOKE_DB = 'coach_smoke';
// List prices per million tokens (input, output) at the time of writing; verify on the pricing page.
const PRICES: Record<string, { in: number; out: number }> = { 'claude-haiku-5-5': { in: 0.1, out: 0.5 }, 'claude-sonnet-5-5': { in: 2, out: 10 } };

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

function estimateUsd(model: string, u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }) {
  const p = PRICES[model];
  if (!p) return null;
  return (u.inputTokens * p.in + u.cacheWriteTokens * p.in * 1.25 + u.cacheReadTokens * p.in * 0.1 + u.outputTokens * p.out) / 1e6;
}

function printTrace(trace: TraceStep[]) {
  for (const s of trace) {
    if (s.type === 'model') console.log(`    turn ${s.turn}: stop=${s.stopReason} in=${s.inputTokens} out=${s.outputTokens} cache_read=${s.cacheReadTokens} cache_write=${s.cacheWriteTokens}`);
    else console.log(`      → ${s.tool}(${JSON.stringify(s.input).slice(0, 160)}) ${s.isError ? `ERROR ${s.output.slice(0, 300)}` : 'ok'} [${s.ms}ms]`);
  }
}

function printProposal(p: ProposalRow) {
  const ev = p.evidence as Fact[];
  console.log(`    proposal ${p.id.slice(0, 8)} [${p.status}] ${p.changeType} ${JSON.stringify(p.proposedChange)} (confidence ${p.confidence})`);
  console.log(`      reason: ${p.reason}`);
  for (const f of ev) console.log(`      · ${f.source === 'computed' ? '(backend) ' : ''}${f.label}: ${f.value}${f.unit ? ` ${f.unit}` : ''}  [${f.id}]`);
}

async function planFingerprint(db: Db, ids: string[]) {
  const rows = await Promise.all(ids.map((id) => plannedWorkoutsRepo.listRange(db, id, '1900-01-01', '2999-12-31')));
  return JSON.stringify(rows.flat().map((w) => [w.id, w.version, w.date, w.durationMin, w.workoutType, w.plannedLoad]));
}

async function main() {
  const env = loadEnv();
  const { llm, embeddings } = createAiAdapters(env);
  if (!llm) throw new Error('ANTHROPIC_API_KEY is not set (see .env.example).');

  const today = toIsoDate(new Date());
  const url = await ensureMigratedDatabase(env.DATABASE_URL, SMOKE_DB);
  const { db, sql } = createDb(url);
  const log = (m: string) => console.warn(`  [warn] ${m}`);
  const deps: AiDeps = { db, now: () => new Date(), llm, embeddings, log };

  try {
    await truncateAllData(db);
    const seeded = await seedDemoTeam(db, { today, password: 'smoke-password' });
    const embedded = await backfillEmbeddings({ db, embeddings, log }).catch((err: Error) => (log(`embedding backfill failed: ${err.message}`), 0));
    console.log(`Seeded ${SMOKE_DB} as of ${today}; embedded ${embedded} notes (${embeddings ? embeddings.model : 'no VOYAGE_API_KEY: full-text only'}).\n`);

    const carlos = seeded.athletes.find((a) => a.name.startsWith('Carlos'))!;
    const marcos = seeded.athletes.find((a) => a.name.startsWith('Marcos'))!;
    const athleteIds = seeded.athletes.map((a) => a.id);
    const planBefore = await planFingerprint(db, athleteIds);
    let totalUsd = 0;

    const runs: { label: string; athleteId: string; exec: () => Promise<{ runId: string; text: string; proposals: ProposalRow[]; citations: Fact[] }> }[] = [
      {
        label: 'Post-activity check for Carlos (Haiku)',
        athleteId: carlos.id,
        exec: async () => {
          const r = await runAnalysis(deps, { athleteId: carlos.id, kind: 'post_activity', trigger: 'smoke' });
          return { runId: r.runId, text: r.summary, proposals: r.proposals, citations: r.citations };
        },
      },
      {
        label: 'Weekly review for Marcos (Sonnet)',
        athleteId: marcos.id,
        exec: async () => {
          const r = await runAnalysis(deps, { athleteId: marcos.id, kind: 'weekly', trigger: 'smoke' });
          return { runId: r.runId, text: r.summary, proposals: r.proposals, citations: r.citations };
        },
      },
      {
        label: 'Chat with Carlos (Sonnet): "Am I ready for my triathlon in December?"',
        athleteId: carlos.id,
        exec: async () => {
          const { run, result } = await runAgentForAthlete(deps, { athleteId: carlos.id, kind: 'chat', trigger: 'smoke', userMessage: 'Am I ready for my triathlon in December?' });
          return { runId: run.id, text: result.text, proposals: await proposalsRepo.listByRun(db, run.id), citations: result.citations };
        },
      },
    ];

    for (const r of runs) {
      console.log(`▶ ${r.label}`);
      const started = Date.now();
      const out = await r.exec();
      const row = (await agentRunsRepo.getById(db, out.runId))!;
      const stored = row.toolTrace as StoredTrace | null;
      printTrace(stored?.trace ?? []);
      const cacheWrite = (stored?.trace ?? []).reduce((a, s) => a + (s.type === 'model' ? s.cacheWriteTokens : 0), 0);
      const usd = estimateUsd(row.model, { inputTokens: row.inputTokens ?? 0, outputTokens: row.outputTokens ?? 0, cacheReadTokens: row.cacheReadTokens ?? 0, cacheWriteTokens: cacheWrite });
      totalUsd += usd ?? 0;
      console.log(`  status=${row.status} model=${row.model} turns=${stored?.turns ?? 0} time=${((Date.now() - started) / 1000).toFixed(1)}s tokens in=${row.inputTokens} out=${row.outputTokens} cache_read=${row.cacheReadTokens} cache_write=${cacheWrite} ≈ $${usd?.toFixed(4)}`);
      if (row.error) console.log(`  error: ${row.error}`);
      console.log(`  reply: ${out.text}`);
      if (out.citations.length) console.log(`  citations: ${out.citations.map((c) => `${c.id}=${c.value}`).join(', ')}`);
      if (stored?.unknownCitations.length) console.log(`  dropped unknown citations: ${stored.unknownCitations.join(', ')}`);
      out.proposals.forEach(printProposal);
      console.log('');

      check(`${r.label}: run succeeded`, row.status === 'succeeded', row.error ?? undefined);
      check(`${r.label}: non-empty reply`, out.text.length > 0);
      check(`${r.label}: used tools before answering`, (stored?.trace ?? []).some((s) => s.type === 'tool' && !s.isError));
      for (const p of out.proposals) {
        const ev = p.evidence as Fact[];
        check(`${r.label}: proposal ${p.id.slice(0, 8)} cites backend facts`, ev.some((f) => f.source === 'cited'));
        check(`${r.label}: proposal ${p.id.slice(0, 8)} carries the computed load impact`, ev.some((f) => f.source === 'computed'));
      }
      if (r.athleteId === carlos.id && r.label.startsWith('Post-activity')) {
        check('Carlos story: post-activity check proposes an adjustment', out.proposals.length >= 1, 'three hard days in a row + rising resting HR');
      }
      if (r.label.startsWith('Chat')) check('Chat answer cites at least one fact', out.citations.length > 0);
      // Billing, auth or request-shape errors will not fix themselves on the next run: stop spending calls.
      if (row.error?.startsWith('llm_error')) {
        console.error(`Aborting: the Claude API call failed (${row.error.slice(0, 200)}).\n`);
        break;
      }
    }

    check('Plan unchanged (the agent only proposes)', (await planFingerprint(db, athleteIds)) === planBefore);

    console.log('Checks:');
    for (const c of checks) console.log(`  ${c.ok ? '✔' : '✘'} ${c.name}${!c.ok && c.detail ? ` — ${c.detail}` : ''}`);
    console.log(`\nEstimated cost of this smoke run: $${totalUsd.toFixed(4)} (list prices; verify on the official pricing page).`);
    if (checks.some((c) => !c.ok)) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
