# Loom script (about 5 minutes)

Before recording: the demo was reseeded today, and Carlos has a waiting proposal (or press
**Run analysis** once, off camera). Keep `README.md` and `docs/ai.md` open in a second tab.

## 1. The problem (20 s)
"Amateur athletes in a training group have lots of watch data but nobody to interpret it and adjust
their plan week by week. This is an AI coach that analyzes each athlete's real data, proposes changes
backed by evidence, and lets a human decide."

## 2. Carlos' dashboard (60 s)
- Log in as **Carlos** with one click.
- KPI tiles: training load this week, acute:chronic ratio with its 0.8–1.3 band, three hard days in a
  row, resting HR +5 bpm over his baseline. "Every number here comes from tested backend functions,
  not from the model."
- Coach summary: the citation chips are fact IDs that the backend resolved to its own values.
- Weekly load and fitness/fatigue charts; each has a table view.

## 3. The proposal (75 s)
- Open the banner → **Proposals**.
- Now → Proposed, the reason, **Evidence cited** (values stored by the backend, not typed by the
  model), and **Plan impact computed by the backend** (weekly load before → after, within ±10%).
- "The agent can't change the plan. It has four read-only tools and one write tool that only
  creates a pending proposal. The ±10% rule, future-workout check and injury rules are in code, in
  one transaction, and a violation goes back to the model as an error so it can fix it."
- **Accept** → Calendar: the workout is marked "Updated by an accepted proposal". Mention `audit_log`.

## 4. Chat (40 s)
- "Am I ready for my triathlon in December?" The answer uses his own data, with citations.
  Unknown fact IDs are dropped by the backend.

## 5. Coach view (40 s)
- Sign out → **Elena** (coach). Team ranking uses aggregates only.
- Review queue: with coach review on, proposals wait here first; she can approve, edit the duration
  or reject. She can open any teammate's dashboard.

## 6. Under the hood (50 s)
- Architecture diagram in the README: Next.js on Vercel, Fastify + pg-boss worker on Railway,
  Postgres + pgvector.
- Separation of concerns enforced by ESLint: `domain/` pure, only `ai/llm-client.ts` imports the SDK,
  `ai/` cannot reach repositories.
- Cost: Haiku for the frequent post-activity check, Sonnet for the weekly review and chat; only
  summaries are sent, and prompt caching covers the rules and athlete context.
- Tests: 141 API tests, agent tests with a scripted fake model (allowlist, invalid input, unknown
  fact IDs, ±10%, injury), and a Playwright happy path in CI.

## 7. Trade-offs (20 s)
"Why not Strava: its API terms rule out AI use and showing data to others, so it's seed data plus FIT/GPX
behind an adapter. With more time: automated evals of proposal quality, an MCP server on the same
tools, more data sources."
