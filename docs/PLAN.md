# AI Team Coach — Execution Plan

Source of truth for the build. Read this together with `CLAUDE.md` at the start of every phase.
Context PDFs live in `_context/` (git-ignored, never commit them).

## Status

| Phase | Status | Notes |
|---|---|---|
| Plan & architecture review | ✅ Done | Approved by Oscar (Node/TypeScript stack). |
| 0. Setup | ✅ Done | Gate green: typecheck, lint, test, /health vs Docker PG, CI green on GitHub. |
| 1. Data + domain | ⏳ Next | Confirm open decisions below before starting. |
| 2. API + auth + approval | ⬜ | |
| 3. Agent | ⬜ | |
| 4. Frontend | ⬜ | |
| 5. Deploy + README | ⬜ | |

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
POST /analysis/run          (manual trigger)
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
- **Cost:** two tiers (Haiku daily, Sonnet weekly/chat); only backend summaries are sent, never raw activities; prompt caching for the athlete profile. Verify prices on official pages.
- **Why the LLM doesn't calculate / why it proposes and doesn't act / why seed + FIT instead of Strava / separation of concerns.**
- **Difficulties:** JSON validation, API error handling, evaluating proposal quality.
- **Trade-offs & more time:** no official Garmin API, no real-time data, basic evals; MCP server, automated evals, more data sources, richer coach view.

## Phase log

- 2026-11-06 — Plan approved. Docker (Colima) verified running. Next: Phase 0.
- 2026-11-06 — Phase 0 done locally: npm workspaces (api, web, packages/contracts), Fastify `/health` with DB check, Drizzle client, Vitest (unit + integration on Docker PG), ESLint boundary rules, Next.js 16 + Tailwind + shadcn, docker-compose (pgvector pg17), CI workflow. Pending: create public repo, push, confirm CI green.
- 2026-11-06 — Phase 1 started: pure `api/src/domain/` (zones, load, intensity, fitness, plan-guardrails) with 17 unit tests. Remaining: weekly-summary, Drizzle schema + migrations, seed scenario, FIT/GPX adapter, ingestion/metrics services, pg-boss jobs.
- 2026-11-06 — Phase 0 gate complete: public repo created, pushed, CI green.
