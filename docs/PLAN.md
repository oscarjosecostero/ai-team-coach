# AI Team Coach — Execution Plan

Source of truth for the build. Read this together with `CLAUDE.md` at the start of every phase.
Context PDFs live in `_context/` (git-ignored, never commit them).

## Status

| Phase | Status | Notes |
|---|---|---|
| Plan & architecture review | ✅ Done | Approved by Oscar (Node/TypeScript stack). |
| 0. Setup | ✅ Done | Gate green: typecheck, lint, test, /health vs Docker PG, CI green on GitHub. |
| 1. Data + domain | ✅ Done | Gate green: 56 tests (unit + integration on Docker PG), typecheck, lint, build. Seed → `weekly_metrics` verified. |
| 2. API + auth + approval | ✅ Done | Gate green: 91 tests (35 new: auth, RBAC, accept/reject/stale/concurrent, coach review, uploads), typecheck, lint, build. |
| 3. Agent | ✅ Done (on Gemini) | Fake-LLM tests green (allowlist, invalid JSON, unknown fact IDs, ±10%, injury). `agent:smoke` 16/16 against real Gemini (`LLM_PROVIDER=gemini`); the Claude run is still pending Anthropic credits. |
| 4. Frontend | ✅ Done | Gate green: `next build`, Playwright happy path (demo login → proposal → accept → calendar updated) + account-switch regression, 139 API tests. In CI. |
| 5. Deploy + README | 🟡 Deployed, gate blocked | Live at https://ai-team-coach.vercel.app (Vercel) + Railway (api, worker, pgvector). Live Playwright: account switch passes; happy path blocked at Run analysis by the same Anthropic credit error as Phase 3. |

Update this table (and add a short "Phase log" entry at the bottom) when a phase gate passes.

## Recommended model / effort per phase

| Phase | Model | Effort |
|---|---|---|
| 0. Setup | Sonnet 5.5 | Medium |
| 1. Data + domain | Sonnet 5.5 | High |
| 2. API + auth + approval | Sonnet 5.5 | Medium |
| 3. Agent | Opus 5.5 | High |
| 4. Frontend | Sonnet 5.5 | Medium |
| 5. Deploy + README | Sonnet 5.5 | Medium |

Workflow: finish phase → update this file → `/clear` → `/model` + `/effort` → "Read CLAUDE.md and docs/PLAN.md, run Phase N".

---

## 1. Product

**Problem.** Amateur athletes in a training group (run, bike, swim, gym, preparing for a triathlon) have lots of watch data but nobody to interpret it and adjust their plan week by week, and no team view.

**Users.** Athletes in the group; optionally a coach who reviews everyone's proposals.

**Value.** An AI coach that analyzes each athlete's real data, proposes plan adjustments backed by evidence, and lets a human decide.

**Demo storyline.**
1. Carlos uploads this morning's 10 km run (FIT file) — or it already exists in seed data.
2. Backend stores it and computes pace, time in HR zones, training load and weekly metrics.
3. Carlos opens the dashboard: today's activity, this week vs. his history, upcoming calendar.
4. A proposal appears: "Three hard sessions in a row and your resting HR is up. I propose replacing Thursday's intervals with a 40-minute easy run." Evidence below, with backend-computed numbers.
5. Carlos accepts (calendar updates) or rejects (plan unchanged). The decision is audited.
6. Chat: "Am I ready for the December triathlon?" — answered from his own data.
7. If the team has a coach, the coach reviews/edits proposals before they reach the athlete.

**Scope.** Must have: data (seed + FIT/GPX), computed metrics, proposals with evidence, accept/reject + audit, README.
Nice to have: chat, team view + ranking, coach review queue. Stretch: Strava adapter, webhooks, MCP server, automated evals.

## 2. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Backend | Node 24 + TypeScript + **Fastify** + **Zod** | One language end to end with Next.js; shared contracts; Zod validates untrusted LLM output at runtime. |
| Frontend | Next.js (latest, App Router) + Tailwind + shadcn/ui + TanStack Query + Recharts | Modern, fast to build a clean UI. |
| Database | Postgres + **pgvector**, **Drizzle ORM** + drizzle-kit migrations | Native `vector` type support, SQL-first. |
| Jobs | **pg-boss** (Postgres-backed queue) | No Redis; one less service. |
| LLM | Anthropic: `claude-haiku-5-5` (post-activity analysis), `claude-sonnet-5-5` (weekly review + chat) | Reliable tool use, good reasoning/explanations, follows system rules. Low temperature, prompt caching on the athlete profile. Verify prices on official pages before citing them. |
| Embeddings | Voyage AI `voyage-3.5-lite` behind `EmbeddingProvider` | Anthropic-recommended; free tier. Falls back to full-text search if no key (hybrid search). *(confirmed)* |
| Data source | **Seed data + FIT/GPX upload** via `ActivitySource` adapters. Strava = optional stretch adapter. | Strava API terms (Nov 2024, reportedly broadened 2026) prohibit using API data in AI applications and displaying a user's data to others (breaks coach/team view). Also new Strava apps allow 1 athlete. Document this in the README. *(confirmed)* |
| Resting HR | `wellness_checkins` table (seed + small form) | Activity data does not include resting HR. |
| Auth | Email + password (hashed), JWT in httpOnly cookie, RBAC (athlete/coach), **one-click demo logins** | Strava login no longer fits; reviewers need instant access. *(confirmed)* |
| Tests | Vitest (unit + integration on real Postgres), 1 Playwright happy path | |
| CI | GitHub Actions: lint, typecheck, test with pgvector service container | |

### Decisions confirmed by Oscar (2026-11-06)
1. ✅ Data source: seed + FIT/GPX primary, Strava stretch-only.
2. ✅ Auth: email/password + demo logins.
3. ✅ Repo: `oscarjosecostero/ai-team-coach`, **public** — OK to create with `gh` in Phase 0. Pushing still needs Oscar's OK.

### Still open
4. ✅ Embeddings: Voyage `voyage-3.5-lite` + full-text fallback (hybrid). Oscar provides `VOYAGE_API_KEY` in Phase 3.
5. Accounts: Anthropic API key (Phase 3), Railway + Vercel (Phase 5).

## 3. Code location & deployment

- **Local:** `/Users/oscarcostero/technical_challenge_personal_ai_project` is the repo root. PDFs moved to `_context/` (git-ignored — they mention internal client/company names).
- **GitHub:** `oscarjosecostero/ai-team-coach` (public, confirmed).
- **Web → Vercel** (root dir `web/`). Next.js rewrite `/api/*` → Railway API URL so the auth cookie is first-party and no CORS is needed.
- **API + worker → Railway**, two services from the same Dockerfile (`node dist/server.js`, `node dist/worker.js`).
- **Postgres → Railway** pgvector template.
- Deploy via each platform's GitHub integration (push to `main` redeploys).
- Env: `DATABASE_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `WEB_ORIGIN`, (stretch) `TOKEN_ENCRYPTION_KEY`, `STRAVA_*`.

## 4. Repo structure

```
ai-team-coach/
├─ api/
│  ├─ src/
│  │  ├─ server.ts / worker.ts / app.ts     # entry points + dependency wiring
│  │  ├─ config/env.ts                       # zod-validated env
│  │  ├─ routes/        # controllers only: auth, dashboard, activities, calendar,
│  │  │                 #   checkins, proposals, chat, team, uploads
│  │  ├─ domain/        # PURE: zones, load (TRIMP), pace, fitness (ATL/CTL/ACWR),
│  │  │                 #   intensity, weekly-summary, plan-guardrails (10% rule)
│  │  ├─ services/      # use cases: ingestion, metrics, proposal (accept/reject),
│  │  │                 #   calendar, team, chat
│  │  ├─ repositories/  # persistence only (Drizzle)
│  │  ├─ integrations/
│  │  │  ├─ activity-source.ts   # ActivitySource interface
│  │  │  ├─ files/               # FIT + GPX adapter
│  │  │  ├─ seed/                # synthetic team adapter
│  │  │  ├─ strava/              # (stretch)
│  │  │  └─ embeddings/          # EmbeddingProvider + Voyage impl
│  │  ├─ ai/
│  │  │  ├─ llm-client.ts        # ONLY file importing the Anthropic SDK
│  │  │  ├─ coach-agent.ts       # tool-use loop (max N turns)
│  │  │  ├─ prompts/             # system prompt + athlete context builder
│  │  │  ├─ tools/registry.ts    # fixed allowlist: read tools + create_proposal
│  │  │  ├─ facts.ts             # fact IDs for evidence citation
│  │  │  └─ schemas/             # zod schemas for tool inputs / proposal output
│  │  ├─ jobs/          # ingest → metrics → analysis; weekly cron
│  │  ├─ db/            # schema.ts, migrations/, seed scenario
│  │  └─ lib/           # auth (JWT/RBAC), errors, logger
│  └─ test/             # unit/ (domain, ai with fake LLM) + integration/ (real PG)
├─ web/src/app/         # /login, /dashboard, /calendar, /proposals, /chat, /team
├─ packages/contracts/  # zod schemas + DTO types shared by api and web
├─ docker-compose.yml   # pgvector/pgvector image
├─ .github/workflows/ci.yml
├─ docs/                # PLAN.md, architecture.md, decisions.md (ADRs), ai.md
├─ CLAUDE.md
└─ README.md
```

Boundaries are enforced with ESLint `no-restricted-imports`:
- `domain/` imports nothing with I/O (no db, no ai, no integrations, no fastify).
- `ai/` cannot import plan-writing repositories/services (only read repositories + proposal creation).
- Only `ai/llm-client.ts` imports `@anthropic-ai/sdk`.
- `routes/` call services; they never touch repositories or the db directly.

## 5. Database schema

```
teams              id, name, coach_review_enabled bool, created_at
users              id, team_id→teams, role ('athlete'|'coach'), name, email UNIQUE,
                   password_hash, created_at
athlete_profiles   user_id PK→users, goal, race_name, race_date, race_type,
                   level ('beginner'|'intermediate'|'advanced'),
                   available_days smallint[], max_hr, lthr, resting_hr_baseline,
                   hr_zones jsonb   -- computed by domain, stored for display
activities         id, user_id, source ('seed'|'file'|'strava'), source_id,
                   UNIQUE(source, source_id),
                   sport ('run'|'bike'|'swim'|'strength'|'other'), started_at,
                   duration_s, moving_time_s, distance_m, elevation_gain_m,
                   avg_hr, max_hr, avg_pace_s_per_km, avg_power_w,
                   time_in_zones_s int[5], training_load numeric,
                   load_method ('hr_trimp'|'duration_estimate'),
                   intensity_class ('easy'|'moderate'|'hard'), rpe smallint,
                   notes text, raw jsonb, created_at
wellness_checkins  id, user_id, date, UNIQUE(user_id, date), resting_hr,
                   sleep_hours, fatigue 1-5, soreness 1-5, note
weekly_metrics     user_id, week_start, PK(user_id, week_start),
                   total_duration_s, total_distance_by_sport jsonb, total_load,
                   load_change_pct, atl, ctl, tsb, acwr, low_intensity_pct,
                   high_intensity_pct, hard_sessions, max_consecutive_hard_days,
                   avg_resting_hr, resting_hr_delta, computed_at
planned_workouts   id, user_id, date, sport, workout_type ('easy'|'long'|'tempo'|
                   'intervals'|'recovery'|'strength'|'brick'|'rest'), title,
                   description, duration_min, target_zone,
                   planned_load (backend-computed),
                   status ('planned'|'completed'|'skipped'), completed_activity_id,
                   origin ('seed'|'manual'|'proposal'), version int  -- optimistic lock
knowledge_chunks   id, user_id, source_type ('activity_note'|'checkin_note'),
                   source_id, content, embedding vector(1024), tsv tsvector,
                   embedding_model, created_at   -- the "brain"; HNSW + GIN indexes
agent_runs         id, user_id, kind ('post_activity'|'weekly'|'chat'), trigger,
                   model, status, tool_trace jsonb, input_tokens, output_tokens,
                   cache_read_tokens, error, started_at, finished_at
proposals          id, user_id, agent_run_id, planned_workout_id,
                   planned_workout_version, change_type ('replace'|'reduce'|'move'|'rest'),
                   proposed_change jsonb (validated), reason text,
                   evidence jsonb (resolved by backend), confidence numeric(3,2),
                   status ('awaiting_coach'|'pending'|'accepted'|'rejected'|'expired'),
                   coach_note, decided_by, decided_at, created_at
audit_log          id, actor_type ('agent'|'athlete'|'coach'|'system'), actor_id,
                   action ('proposal.created'|'proposal.coach_edited'|
                   'proposal.accepted'|'proposal.rejected'|'plan.updated'…),
                   entity_type, entity_id, before jsonb, after jsonb,
                   metadata jsonb, created_at   -- append-only
chat_messages      id, user_id, role, content, agent_run_id, created_at
(stretch) oauth_connections (encrypted tokens), strava_webhook_events
```

## 6. Domain model (backend calculates)

- **HR zones:** 5 zones from LTHR (Friel); fallback %HRmax when LTHR is missing.
- **Training load:** Edwards TRIMP from time in zones when HR is available (`hr_trimp`); otherwise duration × sport/intensity factor (`duration_estimate`, RPE-based when present).
- **Fitness:** ATL = 7-day EWMA, CTL = 42-day EWMA, TSB = CTL − ATL; ACWR = 7-day acute / 28-day chronic average.
- **Intensity distribution:** low (Z1–Z2) vs. high (Z3–Z5) share of time → 80/20 check.
- **Hard session:** ≥ threshold share of time in Z4+ or workout type intervals/tempo; track max consecutive hard days.
- **Resting HR trend:** weekly avg vs. baseline (`resting_hr_delta`).
- **Planned load:** same load model applied to planned workouts (duration × target zone factor).
- **Guardrails (`plan-guardrails.ts`):** weekly planned load change ≤ ±10%; workout must be in the future and owned by the athlete; one open proposal per workout; injury signal ⇒ only `reduce`/`rest` + professional referral.

## 7. Agent design (LLM interprets, agent only proposes)

- **Role:** triathlon coach and performance analyst; works only with the athlete's real data and explains every recommendation; may use polarized 80/20 and acute:chronic load.
- **Fixed rules (prompt + code):** never invent numbers, only use tool output; never change weekly load > 10%; no medical advice, recommend a professional on injury signals; never modify the plan, only propose.
- **Athlete context per call:** goal, race date, zones, threshold, available days, level (cached prompt prefix).
- **Read tools:** `get_week_summary`, `get_history`, `get_calendar`, `search_notes` (hybrid pgvector + full-text).
- **Single write tool:** `create_proposal` → inserts `pending` (or `awaiting_coach` if the team has coach review). No code path from `ai/` to `planned_workouts` writes.
- **Evidence by fact ID:** every read tool returns facts `{ id, label, value, unit }`. The model cites fact IDs only; the backend rejects unknown IDs and stores the backend values. UI evidence numbers always come from the backend.
- **Validation:** tool inputs and proposal JSON validated with Zod + guardrails; on failure the tool returns an error to the model so it can self-correct (max N turns), then the run fails and is logged in `agent_runs`.
- **Accept/reject:** human action via normal routes. Accept = one transaction: check proposal status + workout version, apply change, bump version, write before/after to `audit_log`.
- **Triggers:** activity ingested → metrics → Haiku post-activity analysis (debounced per athlete/day); weekly cron → Sonnet review; manual "Run analysis" button for the demo.
- **Agent identity:** audit entries use `actor_type='agent'`, `actor_id='coach-agent-v1'`.

## 8. API surface (draft)

```
POST /auth/login            POST /auth/demo-login       POST /auth/logout   GET /auth/me
GET  /dashboard             GET  /activities            POST /uploads/activity (FIT/GPX)
GET  /calendar?from&to      POST /checkins
GET  /proposals?status      POST /proposals/:id/accept  POST /proposals/:id/reject
POST /proposals/:id/coach-review   (coach: approve/edit → pending)
POST /analysis/run          (manual trigger, 202 + poll)   GET /analysis/runs   GET /analysis/runs/:id
GET  /chat                  POST /chat
GET  /team/ranking          GET  /team/proposals (coach)
GET  /health
```

## 9. Phases and gates

Each phase ends only when its gate passes. Then update the Status table and the Phase log.

### Phase 0 — Setup (~30 min)
- Move PDFs to `_context/`; `.gitignore` (node_modules, .env*, dist, .next, `_context/`).
- `git init` (branch `main`), npm workspaces: `api`, `web`, `packages/contracts`.
- `api`: Fastify + TS + Zod, `config/env.ts`, `GET /health` with DB check, Drizzle client, Vitest, ESLint (with boundary rules), tsx for dev, tsup/tsc build.
- `web`: create-next-app (TS, Tailwind, App Router, src dir), shadcn/ui init.
- `packages/contracts`: Zod + exported types.
- `docker-compose.yml` with pgvector; `.env.example` files.
- `.github/workflows/ci.yml`.
- Create the public GitHub repo with `gh` (approved by Oscar).
- **Gate:** `npm run typecheck`, `npm run lint`, `npm test` green; `/health` reports DB ok against Docker Postgres; CI green (once the repo exists).

### Phase 1 — Data + domain (~1.5 h)
- Drizzle schema + migrations (incl. `CREATE EXTENSION vector`).
- Domain services (zones, load, fitness, intensity, weekly summary, guardrails).
- Seed scenario: 1 team, 1 coach, 5 athletes, 8 weeks history + 2 weeks plan + check-ins; Carlos has 3 consecutive hard sessions and rising resting HR.
- FIT/GPX adapter via `ActivitySource`; ingestion + metrics services; pg-boss jobs.
- **Gate:** unit tests for zones, TRIMP, ATL/CTL/ACWR, intensity split, guardrails; integration test seed → `weekly_metrics`.

### Phase 2 — API + auth + approval (~1 h)
- Auth (hash, JWT cookie, RBAC, demo logins), routes for dashboard/calendar/check-ins/team.
- Proposal service: accept/reject/coach-review in transactions + audit.
- **Gate:** integration tests — accept updates calendar + audit; reject leaves plan unchanged; stale version rejected; athlete cannot read another athlete's data; coach can.

### Phase 3 — Agent (~1.5 h)
- Load the `claude-api` skill first. `llm-client`, tools, facts, prompt, loop, validation, chat, embeddings + `search_notes`.
- **Gate:** fake-LLM tests — only allowlisted tools callable, invalid JSON rejected, unknown fact IDs rejected, 10% rule enforced, injury path; `npm run agent:smoke` against real Claude on the seed scenario.

### Phase 4 — Frontend (~2 h)
- Dashboard, calendar, proposal inbox (accept/reject with evidence), chat, team ranking + coach queue, FIT upload, check-in form. Load `dataviz` skill before charts.
- **Gate:** `next build` green; Playwright happy path: demo login → see proposal → accept → calendar updated.

### Phase 5 — Deploy + README (~1 h)
- Railway (Postgres pgvector, api, worker), Vercel (web), env vars, seed production DB.
- README: overview, tech stack, how AI is used (why Claude, fair comparison vs OpenAI/Gemini, cost strategy with verified prices), why the LLM doesn't calculate, why it proposes not acts, Strava terms decision, separation of concerns, setup, trade-offs & improvements. Loom script.
- **Gate:** Playwright happy path passes against the live URL.

### Stretch
Strava adapter (personal use only), webhooks, MCP server reusing `ai/tools/registry`, automated evals.

## 10. README talking points (collect as we go)

- **Why Claude:** reliable tool use (query first, then propose), explains its reasoning, follows system rules (no invented numbers, no medical advice); prior experience with the ecosystem and MCP.
- **Fair comparison:** OpenAI — huge ecosystem, mature structured outputs, cheap small models. Gemini — huge context window, competitive pricing. All three work; differences are tool reliability, cost, and prior experience.
- **Cost:** two tiers (Haiku daily, Sonnet weekly/chat); only backend summaries are sent, never raw activities; prompt caching for the athlete profile. Verify prices on official pages. `agent:smoke` prints tokens, cache reads and an estimated cost per run.
- **No temperature:** current models reject sampling parameters; effort levels + code-side validation replace "low temperature" (see `docs/ai.md`).
- **Why the LLM doesn't calculate / why it proposes and doesn't act / why seed + FIT instead of Strava / separation of concerns.**
- **Difficulties:** JSON validation, API error handling, evaluating proposal quality.
- **Trade-offs & more time:** no official Garmin API, no real-time data, basic evals; MCP server, automated evals, more data sources, richer coach view.

## Phase log

- 2026-11-06 — Plan approved. Docker (Colima) verified running. Next: Phase 0.
- 2026-11-06 — Phase 0 done locally: npm workspaces (api, web, packages/contracts), Fastify `/health` with DB check, Drizzle client, Vitest (unit + integration on Docker PG), ESLint boundary rules, Next.js 16 + Tailwind + shadcn, docker-compose (pgvector pg17), CI workflow. Pending: create public repo, push, confirm CI green.
- 2026-11-06 — Phase 1 started: pure `api/src/domain/` (zones, load, intensity, fitness, plan-guardrails) with 17 unit tests. Remaining: weekly-summary, Drizzle schema + migrations, seed scenario, FIT/GPX adapter, ingestion/metrics services, pg-boss jobs.
- 2026-11-06 — Phase 0 gate complete: public repo created, pushed, CI green.
- 2026-11-06 — Phase 1 gate complete. Drizzle schema (12 tables) + migration 0000 (`CREATE EXTENSION vector`, HNSW/GIN indexes, append-only `audit_log` trigger). Domain: dates, planned load, activity metrics, weekly summary. `ActivitySource` adapters: FIT, GPX (idempotent via content hash) and synthetic seed. Repositories, ingestion + metrics services, pg-boss jobs (`metrics.recompute`, daily `metrics.recompute-all`) and `worker.ts`. Seed: 1 coach + 5 athletes, 8 weeks of history, 2 weeks of plan, check-ins; Carlos has 3 consecutive hard days + resting HR +5 bpm, Marcos a load spike (ACWR ~1.9). Run it with `npm run db:seed --workspace api -- --reset`.
  - Decisions made along the way: (a) integration tests use an isolated `coach_test` database created by vitest `globalSetup` (files run serially) so the dev seed is never wiped; (b) `max_consecutive_hard_days` is measured over the 7 days ending at the week end (or today for the current week) so a streak crossing Monday is not hidden; (c) for a partial current week, `load_change_pct` compares against the same number of days of the previous week; (d) team `coach_review_enabled` is `false` in the seed (toggle it to demo the coach queue); (e) all seed accounts share `SEED_PASSWORD` (default `demo-password`); (f) ingestion takes an `afterIngest` hook: the worker enqueues a job, tests/seed run metrics inline.
  - Left for Phase 2: wire an upload route + `PgBossPublisher` into `app.ts`; uploads should ingest synchronously (parse + store) and enqueue the metrics recompute.
- 2026-11-06 — Phase 2 gate complete. Fastify app now wired with `@fastify/jwt` (httpOnly `session` cookie, SameSite=Lax, 7 days) + cookie + multipart; session user is re-read from the DB on every request. Routes: `/auth/{login,demo-login,demo-accounts,logout,me}`, `/dashboard`, `/activities`, `/calendar`, `/checkins`, `/proposals` (+ `/:id`, `accept`, `reject`, `coach-review`), `/uploads/activity` (sync parse+store, async metrics job), `/team/ranking`. Pure `domain/proposal-change.ts` applies reduce/replace/move/rest and recomputes planned load.
  - Decisions: (a) all per-athlete reads go through `services/access.ts` (athlete = self only; coach = own team; other team → 404); (b) only the proposal owner can accept/reject, everyone else (coach included) gets 404; `awaiting_coach` proposals are invisible to the athlete; (c) accept = one transaction: `FOR UPDATE` on proposal + workout, version check (409 `stale_proposal`), future-date check, apply, bump version, audit `proposal.accepted` + `plan.updated` with before/after; (d) coach-review `approve` (optionally with `edit`) → `pending`, or `reject`; audited as `proposal.coach_approved|coach_edited|coach_rejected`; (e) `DEMO_LOGIN_ENABLED` env flag (default true) gates passwordless demo login; (f) team ranking exposes aggregates only (current-week volume, load, hard sessions, ACWR); (g) `proposalService.initialStatusFor` tells Phase 3 which initial status `create_proposal` must use; `proposalsRepo.insert` is the insertion point.
  - Not done on purpose: the ±10% weekly-load guardrail is enforced when a proposal is *created* (Phase 3, `create_proposal`), not re-checked at accept time (the version check already guarantees the plan is the one the guardrail saw). `POST /analysis/run`, `/chat` and `/team/proposals` (covered by `GET /proposals` for coaches) come in Phase 3.
- 2026-11-06 — Phase 3 built (gate pending the real-Claude smoke). Details in `docs/ai.md`.
  - `ai/`: `llm-client.ts` (only SDK import; beta Messages API, effort, auto + system prompt caching, Sonnet server-side refusal fallback, typed `LlmError`), `ports.ts` (`CoachDataPort`: reads + one `createProposal`), `coach-agent.ts` (manual loop, max turns, append-only history), `tools/` (fixed allowlist of 4 read tools + `create_proposal`), `facts.ts` (per-run ledger, `[[fact-id]]` citations), `prompts/`, `schemas/` (Zod → JSON schema), `models.ts` (Haiku medium / Sonnet medium / Sonnet low for chat).
  - Guarded write path `services/agent-proposals.ts`: row lock, ownership, future date, one open proposal per workout, ±10% per touched week (`domain/plan-load.ts`), backend injury rule (`domain/injury-signal.ts`) + fixed referral text, evidence = cited ledger facts + computed load impact, `audit_log` `proposal.created` by `coach-agent-v1`.
  - Routes: `POST /analysis/run` (sync), `GET /analysis/runs`, `GET/POST /chat`. 503 `ai_unavailable` without `ANTHROPIC_API_KEY`. Jobs: upload → metrics → `analysis.post-activity` (debounced per athlete/day, retries rate limits), `analysis.weekly-all` cron Sun 18:00 UTC.
  - Notes search: Voyage `voyage-3.5-lite` behind `EmbeddingProvider`, hybrid pgvector + full-text with RRF, lazy backfill, full-text fallback on any embedding error. Seed backfills embeddings (verified live: 38 notes).
  - Fixed a Phase 0 bug: ESLint boundary rules for `domain/` and `ai/` were silently overridden by the later `src/**` block; now one combined block per layer (verified with probe imports). `ai/` additionally cannot import repositories/services/db.
  - Decisions: (a) no temperature (rejected by current models); (b) manual loop instead of the SDK tool runner, for fake-LLM tests and full traces; (c) the model never passes a workout version: the write path locks the row and stores the version it checked; (d) proposals may only target workouts the run saw in `get_calendar`; (e) chat may create proposals too (same guardrails); (f) `awaiting_coach` proposals are filtered out of athlete-facing responses; (g) `agent:smoke` uses its own `coach_smoke` database.
  - **Gate still open:** `npm run agent:smoke` reached the API but every call returned `400 credit balance is too low`. Add credits to the Anthropic account, then run it and mark Phase 3 done.
- 2026-11-06 — Phase 4 gate complete (Phase 3 still waits on the real-Claude smoke). Next.js 16 app in `web/`: `/login` (one-click demo accounts + password form), `/dashboard`, `/calendar`, `/proposals`, `/chat`, `/team` (ranking + coach review queue). TanStack Query over `/api/*`, which `next.config.ts` rewrites to the API (`API_URL`, first-party cookie, `proxyTimeout` 180 s for the synchronous analysis). Charts with Recharts following the `dataviz` skill (validated palette light + dark, one-axis charts, table view per chart, stat tiles, ACWR meter, segmented bars). Dark mode via `next-themes`.
  - API additions for the UI (so the browser never computes figures): proposals include the target workout's current state and the athlete name; `/calendar` returns weekly planned-load totals (domain `plannedLoadByWeek`); `/dashboard` returns `daysToRace`; `/analysis/runs` returns resolved citations and proposal ids.
  - E2E: `web/playwright.config.ts` starts the API on :4100 against a fresh `coach_e2e` database and `next dev` on :3100. The fixture (`api/test/e2e/seed-e2e.ts`) creates Carlos' proposal by running the real agent loop, tools and guarded write path with the scripted model, so no API key is needed. `SCREENSHOTS=1 npx playwright test` saves light/dark/mobile screenshots to `web/e2e/screenshots/` (git-ignored). `E2E_BASE_URL` points the same spec at a deployed site (Phase 5 gate).
  - Next 16 specifics we hit: (a) with Cache Components the signed-in layout must always render its page (an auth gate that swaps the page for "Loading…" drops the segment from the static shell); the session is `null` while `/auth/me` loads and each view shows its own skeleton; (b) Next keeps visited routes alive with React `<Activity>`, so transient state (the login page's "busy" flag, the password) is reset in a `useLayoutEffect` cleanup; a regression test covers athlete → coach → athlete.
  - Phase 5 notes: set `API_URL` on Vercel at build time; check Vercel's own timeout for external rewrites against the synchronous `POST /analysis/run` (or make it async with polling).
- 2026-11-06 — Phase 5 prepared (deploy pending Oscar's Railway/Vercel accounts). Committed Phases 3 and 4 separately.
  - `POST /analysis/run` is now asynchronous: `202 { run }`, then `GET /analysis/runs/:id` (run + visible proposals). Reason: Vercel's external rewrites wait at most 120 s and a weekly Sonnet review can take longer. A second click while a run is in progress returns that run; `onClose` waits for in-flight runs. The web button polls inside the mutation and also shows "Analyzing…" for runs started elsewhere (upload, another tab). Also fixed: `GET /analysis/runs` leaked the IDs of `awaiting_coach` proposals to the athlete.
  - Production: root `Dockerfile` (one image; API `node dist/server.js`, worker `node dist/worker.js`, seed `node dist/scripts/seed.js --reset`), `.dockerignore`, API applies migrations on start, graceful SIGTERM. Verified locally: fresh DB → migrations → `/health` ok → seed → worker up.
  - `DEMO_DAILY_RESEED=true` (worker): 04:00 UTC reseed as of that day, then post-activity checks for every athlete, so the seed story never goes stale and proposals are waiting each morning.
  - E2E: the API under Playwright now runs `test/e2e/serve-e2e.ts` (production app + scripted model), which adds an e2e test for the Run analysis button (202 + polling + cited summary). With `E2E_BASE_URL`, the happy path runs the analysis itself if no proposal is waiting and relaxes fixture-specific assertions. 141 API tests, 3 e2e tests.
  - Docs: `README.md`, `docs/deploy.md` (runbook), `docs/loom-script.md`; `docs/ai.md` gained the async-run section.
- 2026-11-06 — Railway deployed (project `ai-team-coach`): pgvector (Postgres 18), `api` at `https://api-production-39879.up.railway.app` (`/health` ok, migrations on start), `worker` (`node dist/worker.js`, `DEMO_DAILY_RESEED=true`, secrets referenced from `api`). Production seeded (38 notes embedded); demo login and Carlos' dashboard verified. Gotchas recorded in `docs/deploy.md`: setting `dockerfilePath` through the API switched the builder to Railpack, and "Redeploy" replays old settings (use a new deployment). Next: Vercel (`API_URL` = the api domain), then the live Playwright gate (needs Anthropic credits for a real proposal).

- 2026-11-06 — Vercel deployed with the CLI: project `ai-team-coach`, root `web`, Node 24, `API_URL` → Railway api; live at https://ai-team-coach.vercel.app (`/api/health` ok through the rewrite). `.vercelignore` keeps `_context/`, `.env*` and the API source out of CLI uploads. GitHub push-to-deploy pending: Oscar must add GitHub under Vercel Account → Login Connections, then `vercel git connect`. Live Playwright run: account switch ✔; happy path ✘ at Run analysis — the run fails with "credit balance is too low" (Anthropic), so no real proposal can be created yet. The spec now fails fast on a failed run instead of waiting 4 minutes.
- 2026-11-06 — Push-to-deploy on: Vercel linked to `oscarjosecostero/ai-team-coach` (`main`), Railway `api` and `worker` have GitHub deployment triggers on `main` (needed GitHub linked to the Railway account, not only the app installed). Redeploys after connecting verified: Dockerfile build, worker start command kept, `/api/health` ok through Vercel.
- 2026-11-06 — Gemini added as a second LLM provider while the Anthropic account has no credits: `ai/gemini-client.ts` (only importer of `@google/genai`, enforced by ESLint) implements `LlmClient`; `LLM_PROVIDER=auto|anthropic|gemini` selects it; profiles gained a provider-neutral `tier` (fast/smart) and `agent_runs.model` records the model actually called. Unit tests for the translation (tools as JSON Schema, function calls/responses, thought signatures, finish reasons, usage, errors) and an integration test of the real loop + guarded write path on the Gemini adapter. `agent:smoke` works with either provider.
- 2026-11-06 — Phase 3 gate passed on Gemini: `LLM_PROVIDER=gemini npm run agent:smoke` 16/16 (post-activity on `gemini-3.1-flash-lite`: the backend rejected −50% and −12.5% load changes and the model self-corrected to −8.3%; weekly review on `gemini-3.5-flash` used all four read tools and proposed −8%; chat answered with 7 resolved citations; plan unchanged). Gemini 2.5 is closed to new users, so defaults moved to 3.1 Flash-Lite / 3.5 Flash (`npm run gemini:models` lists what a key can call). The free tier answers 403/503 intermittently for a valid key, so the adapter retries 403/429/5xx with backoff. Also: inline `[[fact-id]]` citations in a proposal reason now join its evidence (unknown ones are dropped) and the UI renders them as chips. The Claude smoke run remains pending Anthropic credits.
