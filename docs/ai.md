# AI layer — how the coach agent works

The backend calculates, the LLM interprets, the agent only proposes, a human decides.
This document describes `api/src/ai/` and the services around it.

## Flow

```
upload FIT/GPX ─► ingest (sync) ─► metrics.recompute job ─► analysis.post-activity job (Haiku)
weekly cron (Sun 18:00 UTC) ─────────────────────────────► analysis.weekly-all job (Sonnet)
POST /analysis/run (manual button) ──────────────────────► same analysis, in the background (202 + polling)
POST /chat ──────────────────────────────────────────────► chat run (Sonnet)

run = agent_runs row (running) ─► coach-agent loop ─► agent_runs row (succeeded|failed,
      tokens, cache reads, tool trace, final reply, resolved citations)
```

## Layers and what each one may touch

| Piece | Role | Can import |
|---|---|---|
| `ai/llm-client.ts` | Only file that imports `@anthropic-ai/sdk`. `LlmClient` interface + `AnthropicLlmClient`; maps SDK errors to `LlmError { kind, retryable }`. | the SDK |
| `ai/gemini-client.ts` | Only file that imports `@google/genai`. `GeminiLlmClient`, a second provider behind the same interface. | the Gemini SDK |
| `ai/ports.ts` | `CoachDataPort`: the agent's whole world. Read methods plus **one** write, `createProposal`. | types only |
| `ai/coach-agent.ts` | Manual tool-use loop, bounded by `maxTurns`; append-only history. | `ai/*`, `domain/*` |
| `ai/tools/` | Fixed allowlist: `get_week_summary`, `get_history`, `get_calendar`, `search_notes`, `create_proposal`. | `ai/*`, `domain/*` |
| `ai/facts.ts` | Per-run `FactLedger`; inline `[[fact-id]]` citation resolution. | — |
| `ai/prompts/` | Static rules prompt, per-athlete context, kickoff messages. | — |
| `services/coach-data.ts` | Implements the port over repositories (maps rows to slim agent types). | repositories |
| `services/agent-proposals.ts` | The guarded write path behind `create_proposal`. | repositories, domain |
| `services/analysis.ts`, `services/chat.ts` | Start/finish runs, RBAC, persistence. | everything above |

ESLint enforces this: `ai/` cannot import `repositories/`, `services/`, `db/`, `jobs/`, `routes/` or Drizzle,
and only `ai/llm-client.ts` may import the SDK. So there is no code path from the agent to a
`planned_workouts` write — the port has no such method, and the agent can't reach around it.

(While doing this we found the Phase 0 boundary rules were silently overridden by a later
`src/**` block — flat config replaces a rule's options — so `domain/` and `ai/` bans never fired.
Fixed in `api/eslint.config.mjs`: one combined `no-restricted-imports` block per layer.)

## Evidence by fact ID

Every read tool returns facts `{ id, label, value, unit }` built from stored, backend-computed rows
(weekly metrics, activities, check-ins, planned load, notes). IDs are readable and stable:
`wk:2026-11-02:acwr`, `act:1a2b3c4d:avg_hr`, `chk:2026-11-05:resting_hr`, `pw:…:planned_load`,
`plan:2026-11-09:allowed_max`, `note:…`, `profile:days_to_race`, `signal:injury`.

- The run's `FactLedger` registers every fact a tool returned. `create_proposal` resolves the cited
  `evidenceFactIds` there; **any ID the run did not receive is rejected** (made up, or real but
  never fetched). The stored evidence is the ledger's values, never model text.
- The write path appends backend-computed facts itself (`impact:<week>:planned_load_before/after/change_pct`,
  `source: 'computed'`), so the UI can show "1041 → 951 (−8.6%)" without the model producing a number.
- Chat replies cite inline as `[[fact-id]]`; the backend resolves them, drops unknown ones from the
  text, and stores the resolved citations with the run (`GET /chat` returns them).
- Formatting is a backend job too (pace `5:12 min/km`, km, minutes), so the model never converts units.

## Guardrails (code, not prompt)

`create_proposal` does cheap checks to give the model precise errors (allowlisted workout seen in
`get_calendar`, change shape, known fact IDs, max proposals per run). The checks that make a proposal
safe run again in `services/agent-proposals.ts`, **inside one transaction that locks the workout row**:

- workout exists and belongs to the athlete (else the same `not_found` for both cases);
- workout and the new date are in the future;
- one open (`pending`/`awaiting_coach`) proposal per workout — checked after the row lock, so two
  concurrent runs can't both pass;
- **±10% weekly planned load** for every week the change touches (a `move` can touch two), computed
  with the same `plannedWorkoutLoad` the plan uses (`domain/plan-load.ts` + `domain/plan-guardrails.ts`);
- **injury ⇒ reduce/rest only**: `domain/injury-signal.ts` flags soreness 5/5 or pain/injury words in
  the last 7 days of check-in and activity notes. The model can raise the flag (`injuryConcern`), never
  lower it. Under the flag, large reductions are allowed and the backend appends a fixed referral to
  a physiotherapist/doctor to the reason.

On failure the tool returns `is_error: true` with the violations and the computed load impact
(before, after, change %, allowed range), the model adjusts, and the turn limit bounds the retries.
Initial status is `awaiting_coach` when the team has coach review, else `pending`. Every insert writes
`audit_log` (`actor_type='agent'`, `actor_id='coach-agent-v1'`, `proposal.created`, load impact and
injury signal in metadata). Accepting stays a human action through the Phase 2 routes.

## Second provider: Gemini

`LLM_PROVIDER` picks the provider at startup (`auto`: Claude when `ANTHROPIC_API_KEY` is set, otherwise
Gemini when `GEMINI_API_KEY` is set). Nothing outside `ai/gemini-client.ts` changes: the loop, tools,
fact ledger, guardrails and tests are provider-neutral. The adapter translates the Messages-API shapes
the loop speaks to Gemini function calling:

- system blocks → `systemInstruction`; tools → `functionDeclarations` with `parametersJsonSchema`
  (the same JSON Schemas generated from Zod); automatic function calling is disabled, so the loop
  still validates and runs every call itself.
- `tool_use` ↔ `functionCall`, `tool_result` ↔ `functionResponse` (matched by name, and by id when
  Gemini issues one). Gemini's `thoughtSignature` rides on the converted block and is sent back on the
  next turn, the equivalent of passing Claude's thinking blocks back unchanged.
- `tier` on each profile picks the model: `fast` → `GEMINI_MODEL_FAST` (default `gemini-3.1-flash-lite`),
  `smart` → `GEMINI_MODEL_SMART` (default `gemini-3.5-flash`); `npm run gemini:models` lists what a key
  can call (Gemini 2.5 is closed to new users). Effort maps to a thinking budget on 2.x
  models and to a thinking level on Gemini 3.
- Finish reasons map to the stop reasons the loop already handles (`MAX_TOKENS` → `max_tokens`, safety
  blocks → `refusal`), and usage keeps Claude's meaning (input excludes cache reads). `agent_runs.model`
  records the model actually called.

Caveats: the Gemini API free tier is per project and per model, and its daily limits are low and change
without notice; each run makes several model calls. The weekly review and daily reseed can use it up.

## Models, effort and cost

| Run | Model | Effort | Max turns | Max proposals |
|---|---|---|---|---|
| Post-activity check | `claude-haiku-5-5` | medium | 8 | 1 |
| Weekly review | `claude-sonnet-5-5` | medium | 10 | 2 |
| Chat | `claude-sonnet-5-5` | low | 6 | 1 |

- **No temperature.** The plan said "low temperature"; current models (and the SDK's API version
  `2026-10-21`) reject sampling parameters. Determinism comes from the guardrails and validation,
  and depth/cost from `output_config.effort`. Adaptive thinking is on by default on both models.
- **Prompt caching.** Tools (fixed order, generated once) → system block 1: static rules (identical for
  every athlete and day) → system block 2: athlete context (goal, race, zones, thresholds, available
  days; the date is its last line) → messages. Breakpoints on both system blocks plus top-level
  automatic caching for the growing tool loop. `agent_runs.cache_read_tokens` records the hit rate.
- **Only summaries go to the model**: weekly aggregates, per-activity metrics, check-ins, planned
  workouts and notes. No raw FIT/GPX streams, GPS or e-mail addresses.
- **Refusals.** `stop_reason: "refusal"` fails the run without running tools. Sonnet requests opt into
  the server-side fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`, Claude API
  only); Haiku 5.5 has no server-side fallback, so it is off for that profile.
- `npm run agent:smoke` prints tokens, cache reads/writes and an estimated cost per run from list
  prices (verify prices on the official pricing page before quoting them).

## The loop

`runCoachAgent` (manual loop, not the SDK tool runner, so tests can drive it with a scripted fake and
so every step is traced): call the model → `tool_use`: run each call **sequentially** (the write may
depend on an earlier read), return all results in one user message → repeat until `end_turn`.
Assistant content is appended unchanged (thinking blocks included) and nothing earlier is ever edited,
which keeps both the prompt cache and the model's reasoning valid across turns.

Terminal cases: `refusal` and `max_tokens` (a truncated tool input is never executed) fail the run;
unknown tool names, invalid JSON/shape and guardrail violations become `is_error` tool results; `LlmError`
fails the run with a `retryable` flag (the job retries rate limits/overload; billing/auth/400s don't
retry); anything else is a bug and propagates.

## Manual runs are asynchronous

`POST /analysis/run` authorizes, creates the `agent_runs` row and answers `202 { run }` at once; the
agent runs in the API process and the client polls `GET /analysis/runs/:id` (status, summary,
citations, proposals). A weekly review can take longer than Vercel's 120 s limit for external
rewrites, so a synchronous request would be cut off. A second click while a run of the same kind is
in progress (started in the last 10 minutes) returns that run instead of paying for another one, and
closing the server waits for in-flight runs (graceful redeploys). Chat stays synchronous: it runs on
low effort with at most 6 turns.

## Notes search ("the brain")

`knowledge_chunks` holds activity and check-in notes with a `tsvector` (GIN) and a 1024-d Voyage
`voyage-3.5-lite` embedding (HNSW, cosine). `search_notes` runs full-text and vector search and merges
them with reciprocal rank fusion. Missing vectors are backfilled by the seed script and lazily before a
search; if Voyage is not configured or fails (e.g. the free tier's 3 requests/min), search degrades to
full-text instead of failing (`mode: "text"` in the tool result).

## Testing

- `test/unit/ai/agent.test.ts`, `test/unit/domain/injury-and-load.test.ts`: ledger and citations,
  registry (allowlist, schemas, errors never thrown), append-only history with thinking blocks,
  `max_tokens`/API error handling, injury detection, load impact.
- `test/integration/agent.test.ts` (scripted fake LLM on the seeded Postgres): only allowlisted tools
  callable, invalid input rejected then self-corrected, unknown fact IDs rejected and evidence stored
  with backend values, ±10% rule (decrease and increase), one open proposal per workout, coach review
  status, injury path (backend- and model-raised), max turns and refusal recorded in `agent_runs`.
- `test/integration/agent-api.test.ts`: `/chat` and `/analysis/run` end to end, RBAC, 503 without a key,
  hybrid search (semantic, both, full-text fallback), job chaining and per-day debounce.
- `npm run agent:smoke`: real Claude on a fresh seed in its own `coach_smoke` database.
