# AI Team Coach — Project Rules

Full-stack technical challenge: an AI coach for a triathlon/fitness team. The full plan, decisions,
schema and phase status live in `docs/PLAN.md` — read it before doing anything.

## Language
- Everything in the repo is **English**: code, comments, UI copy, prompts, docs, commits, PRs.
- Conversation with Oscar may be in Spanish.

## Non-negotiable architecture rules
1. **The backend calculates, the LLM interprets.** All numbers (load, zones, pace, ATL/CTL/ACWR,
   deltas) come from pure functions in `api/src/domain/`. The LLM never computes figures.
2. **The agent only proposes.** The AI layer has read-only tools plus exactly one write tool,
   `create_proposal`, which inserts a pending proposal. Plan changes happen only when a human
   accepts through the normal API route, inside a transaction that writes `audit_log`.
3. **Rules live in code, not in the prompt.** Guardrails (±10% weekly load, ownership, future
   workouts, injury ⇒ reduce/rest) are enforced in `domain/plan-guardrails.ts` and Zod schemas.
4. **Evidence is cited by fact ID.** Tools return facts with IDs; the model cites IDs; the backend
   resolves them to stored values. Unknown IDs are rejected.
5. **Separation of concerns** (enforced with ESLint `no-restricted-imports`):
   - `routes/` validate, call a service, respond. No db access.
   - `domain/` is pure: no I/O, no db, no AI, no framework imports.
   - `integrations/` are adapters behind interfaces (`ActivitySource`, `EmbeddingProvider`).
   - `ai/` is the only layer that knows about the LLM; only `ai/llm-client.ts` imports the SDK.
   - `repositories/` are the only place that touches Drizzle.
   - `jobs/` run sync/analysis outside the HTTP request.

## Workflow
- Work in phases (see `docs/PLAN.md`). A phase is done only when its gate (tests) passes.
  Then update the Status table and the Phase log in `docs/PLAN.md`.
- Never commit `_context/` (private PDFs) or `.env*` files (except `.env.example`).
- Ask Oscar before outward-facing actions: creating the GitHub repo, pushing, deploying.
- Load the `claude-api` skill before writing LLM code; load `dataviz` before writing charts.

## Commands
- Start Docker: `colima start` · DB: `docker compose up -d`
- `npm run dev` (api, :4000) · `npm run dev:web` · `npm run build` · `npm run typecheck` · `npm run lint` · `npm test`
