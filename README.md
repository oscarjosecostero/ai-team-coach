# AI Team Coach

An AI coach for an amateur triathlon/fitness group. It reads each athlete's real training data,
explains what it sees, and **proposes** plan changes backed by cited evidence. A human (the athlete,
or the coach first) accepts or rejects them. Nothing changes in the plan without that decision.

> **The backend calculates, the LLM interprets, the agent only proposes, a human decides.**

**Live demo:** _URL added after the first deploy_ — one-click demo logins, no sign-up.

| Account | Story in the seed data |
|---|---|
| **Carlos** (athlete) | Three hard days in a row and resting HR +5 bpm → the coach proposes an easier Thursday. |
| **Marcos** (athlete) | Load spike (acute:chronic ratio ≈ 1.9). |
| Ana, Lucía, Diego (athletes) | Steady training, for the team ranking. |
| **Elena** (coach) | Team ranking, review queue (approve / edit / reject before athletes see proposals), any athlete's dashboard. |

## What it does

1. An athlete uploads a FIT/GPX file (or uses the seeded history). The backend computes pace, time in
   heart-rate zones, training load (TRIMP), weekly totals, fitness/fatigue (CTL/ATL), the
   acute:chronic load ratio, the intensity split and the resting-HR trend.
2. A background job runs a **post-activity check** (Claude Haiku). A weekly cron and a
   **Run analysis** button run a **weekly review** (Claude Sonnet).
3. The agent reads the athlete's data through read-only tools and, if the data supports it, calls its
   only write tool, `create_proposal`. The backend validates the proposal (±10% weekly load, future
   workout, injury rules), stores the evidence values itself, and records it in `audit_log`.
4. The athlete sees the proposal with **Now → Proposed**, the reason, the cited evidence and the plan
   impact computed by the backend. **Accept** updates the calendar in one audited transaction; **Reject**
   leaves the plan unchanged.
5. **Chat:** "Am I ready for my triathlon in December?" is answered from the athlete's own data, with
   every number shown as a citation chip that carries the backend value.

## Architecture

```
            Vercel                                      Railway
┌──────────────────────────┐  /api/* rewrite  ┌──────────────────────────────┐
│ Next.js 16 (App Router)  │ ───────────────► │ Fastify API   (dist/server)  │──┐
│ TanStack Query, Recharts │  first-party     │ routes → services → repos    │  │   ┌──────────────┐
│ shadcn/ui, Tailwind 4    │  session cookie  └──────────────────────────────┘  ├──►│ Postgres 17  │
└──────────────────────────┘                  ┌──────────────────────────────┐  │   │ + pgvector   │
                                              │ pg-boss worker (dist/worker) │──┘   └──────────────┘
                                              │ metrics, analysis, crons     │
                                              └──────────────────────────────┘
                     API and worker → ai/llm-client.ts (only SDK importer)
                                    → Claude Haiku 5.5 / Sonnet 5.5, Voyage embeddings
```

```
api/src/
  domain/        pure functions: zones, TRIMP, ATL/CTL/ACWR, weekly summary, plan guardrails, injury signal
  integrations/  adapters behind interfaces: ActivitySource (FIT, GPX, seed), EmbeddingProvider (Voyage)
  ai/            the only layer that knows about the LLM: client, agent loop, tools, fact ledger, prompts
  services/      use cases (ingestion, metrics, proposals, analysis, chat) — the only callers of repositories
  repositories/  the only code that touches Drizzle
  routes/        validate (Zod), call a service, respond
  jobs/          pg-boss handlers and schedules
packages/contracts/  Zod schemas shared by API and web
web/                 Next.js app
```

The boundaries are enforced with ESLint `no-restricted-imports`: `domain/` has no I/O, `routes/`
cannot reach the database, `ai/` cannot import repositories or services, and only
`ai/llm-client.ts` may import `@anthropic-ai/sdk`. Details: [`docs/ai.md`](docs/ai.md).

## How the AI is used

### Why the LLM does not calculate
Language models are good at interpreting and explaining, and unreliable at arithmetic. Every number
(load, zones, pace, ratios, deltas, a proposal's effect on weekly load) comes from tested pure
functions in `api/src/domain/`. The model only receives backend-computed summaries and is asked to
explain them. Even unit formatting (`5:12 min/km`) is done by the backend.

### Why it proposes and does not act
A training plan affects someone's health. The agent has four read-only tools (`get_week_summary`,
`get_history`, `get_calendar`, `search_notes`) and exactly one write tool, `create_proposal`, which
inserts a *pending* proposal. There is no code path from `ai/` to a `planned_workouts` write: the
port the agent is given has no such method, and ESLint stops it from importing around the port.
Accepting is a human action on a normal API route, in a transaction that checks the workout version
and writes before/after to `audit_log`.

### Evidence by fact ID, not by trust
Each tool returns facts with stable IDs (`wk:2026-11-02:acwr`, `act:1a2b3c4d:avg_hr`,
`plan:2026-11-09:allowed_max`…). The model cites IDs; the backend resolves them from a per-run ledger
and **rejects any ID the run never received**. The stored evidence is the backend's values, never
model text. Chat replies cite inline as `[[fact-id]]` and are resolved the same way.

### Rules live in code
The prompt states the rules, and the code enforces them on every proposal, in one transaction with
the workout row locked:
- weekly planned load may change by at most **±10%**, checked for every week a change touches;
- the workout must be in the future and belong to the athlete; one open proposal per workout;
- **injury signal ⇒ reduce or rest only**, plus a fixed referral to a physiotherapist or doctor. The
  backend raises the signal from check-ins and notes; the model can raise it, never lower it.

A violation goes back to the model as a tool error with the computed numbers, so it can correct
itself within a bounded number of turns.

### Why Claude, and a fair comparison
- **Why Claude:** reliable multi-step tool use (it reads data before proposing), clear explanations,
  and good adherence to system rules (no invented numbers, no medical advice). I also already know
  the ecosystem (SDK, prompt caching, MCP).
- **OpenAI** has the largest ecosystem, mature structured outputs and cheap small models.
  **Gemini** has very large context windows and competitive pricing. All three could build this.
  The differences that mattered here were tool-use reliability, cost per run and prior experience.
  The LLM sits behind one `LlmClient` interface, so swapping providers is a single adapter.

### Models, effort and cost
| Run | Model | Effort | When |
|---|---|---|---|
| Post-activity check | `claude-haiku-5-5` | medium | after each upload (debounced to one per athlete per day) |
| Weekly review | `claude-sonnet-5-5` | medium | Sundays 18:00 UTC, and the Run analysis button |
| Chat | `claude-sonnet-5-5` | low | each message |

List prices (verified November 2026; check the official pricing page before relying on them):
Haiku 5.5 is $0.10 / $0.50 per million input/output tokens for prompts up to 100K tokens; Sonnet 5.5
is $2 / $10. Cache reads cost 0.1× the input rate.

How the cost stays low:
- **Two tiers.** The frequent, small job runs on Haiku; Sonnet is used only for the weekly review and chat.
- **Only summaries go to the model**: weekly aggregates, per-activity metrics, check-ins, planned
  workouts and short notes. Never raw FIT/GPX streams, GPS tracks or e-mail addresses.
- **Prompt caching.** Tools are defined in a fixed order, and the static rules and the per-athlete
  context are separate cached system blocks, so the tool loop re-reads them at the cache rate.
- **Bounded runs:** a maximum number of turns and proposals per run, and `agent_runs` records
  tokens and cache reads for every run.
- `npm run agent:smoke` runs one Haiku check, one Sonnet review and one chat turn on the real API,
  and prints tokens, cache hits and an estimated cost per run.

**No temperature.** The plan said "low temperature", but current models (and the SDK's API version)
reject sampling parameters. Consistency comes from code-side validation and guardrails; depth and
cost are set with `output_config.effort`.

### Notes search ("the brain")
Activity and check-in notes are embedded with Voyage `voyage-3.5-lite` (1024-d, pgvector HNSW) and
indexed with Postgres full-text search. `search_notes` merges both with reciprocal rank fusion, so
"knee" finds "my joints ache". Without a Voyage key, or if the API fails, search falls back to
full-text instead of failing.

## Data sources: why seed + FIT/GPX instead of Strava
Strava's API agreement (updated November 2024) does not allow API data to be used in AI applications
or shown to other users (which would break the coach and team views). New Strava apps are also
limited to a single athlete. So the app uses an `ActivitySource` interface with three adapters:
**FIT** and **GPX** uploads (idempotent by content hash) and a synthetic **seed** team. A Strava
adapter for personal use would be one more adapter, not a redesign.

## Running locally

Requirements: Node 24, Docker (Colima on macOS: `colima start`).

```bash
cp .env.example .env            # add ANTHROPIC_API_KEY / VOYAGE_API_KEY for the AI features
npm install
docker compose up -d            # Postgres 17 + pgvector
npm run db:migrate --workspace api
npm run db:seed --workspace api -- --reset
npm run dev                     # API on :4000
npm run worker --workspace api  # pg-boss worker (metrics, analysis, crons)
npm run dev:web                 # web on :3000
```

Without `ANTHROPIC_API_KEY` everything works except analysis and chat, which return a clear
"AI not configured" message (503).

## Tests

```bash
npm run typecheck && npm run lint
npm test                              # 141 API tests: unit + integration on real Postgres
npm run test:e2e --workspace web      # Playwright, no API key needed
npm run agent:smoke                   # real Claude on a fresh seed (costs a few cents)
```

- **Domain:** zones, TRIMP, ATL/CTL/ACWR, intensity split, guardrails, injury signal, load impact.
- **API:** auth, RBAC (an athlete cannot read another athlete; a coach can read their team), accept
  updates the calendar and the audit log, reject leaves the plan unchanged, stale and concurrent
  accepts are rejected, coach review.
- **Agent, with a scripted fake model on the real database:** only allowlisted tools can be called,
  invalid tool input is rejected and the model corrects itself, unknown fact IDs are rejected, the
  ±10% rule (both directions), one open proposal per workout, the injury path, max turns and refusals.
- **E2E (Playwright):** demo login → see the proposal with evidence → accept → calendar updated; the
  Run analysis button (async run + polling); switching accounts. The fixture creates the proposal by
  running the real agent loop and guarded write path with a scripted model.
- CI (GitHub Actions) runs all of it except the smoke test, against a pgvector service container.

## Deployment
Web on **Vercel** (root directory `web/`, `API_URL` set at build time), API and worker on **Railway**
(two services from the root `Dockerfile`), Postgres with pgvector on Railway. The API applies
migrations on start, and the worker can reseed the demo daily so the story stays current. Step by
step: [`docs/deploy.md`](docs/deploy.md).

## Trade-offs and difficulties
- **Validating model output.** Tool inputs are strict Zod schemas. Errors go back to the model as
  tool results instead of exceptions, so it can correct itself, and the turn limit bounds the retries.
- **API errors.** SDK errors are mapped to typed `LlmError`s with a `retryable` flag. Jobs retry
  rate limits and overload, but not billing or invalid requests. Refusals and `max_tokens` fail
  the run, so a truncated tool call is never executed.
- **Long runs behind a proxy.** Vercel's external rewrites wait at most 120 s, and a weekly review can
  take longer. So `POST /analysis/run` answers `202` at once and the client polls the run.
- **Evaluating proposal quality** is the hard, open part. Today the guarantees are structural (valid,
  safe, cited), not about whether a proposal is the *best* coaching decision.
- **No official Garmin API** and no real-time data: uploads and seed data only.

## With more time
- Automated evals: a labelled set of athlete weeks, with expected and acceptable proposals, graded per run.
- An MCP server that reuses `ai/tools/registry`, so other agents can query the same data.
- A Strava adapter (personal use) and webhooks; more data sources (sleep, HRV).
- A richer coach view: trends across the team, and proposal acceptance rate per athlete.
- Streaming chat responses.

---
Built for a technical challenge. Design notes: [`docs/ai.md`](docs/ai.md) · plan and phase log:
[`docs/PLAN.md`](docs/PLAN.md) · demo script: [`docs/loom-script.md`](docs/loom-script.md).
