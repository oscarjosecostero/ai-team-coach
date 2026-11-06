# Loom script (about 7 minutes)

Two parts: a demo that follows one athlete through the product (about 5 minutes), then short, spoken
answers to what the challenge asks to see explained (about 2 minutes). Say it in your own words; the
lines in quotes are a guide, not something to read.

## Before recording
- Record before 04:00 UTC (the daily reseed resets the demo data and queues new analyses).
- Carlos should have a waiting proposal. If not, press **Run analysis** once, off camera (1–2 min).
- Tabs: the live app (https://ai-team-coach.vercel.app), the README on GitHub, and `docs/ai.md`.
- Browser at 1280 px wide or more, light mode, notifications off.

---

## Part 1 — Demo

### 1. The problem (20 s)
"Amateur triathletes in a training group have a lot of watch data and nobody to interpret it and
adjust their plan week to week. One coach can't look at every athlete every day. This is an AI coach
that reads each athlete's real data, proposes plan changes backed by evidence, and leaves the
decision to a person."

### 2. Carlos' dashboard (70 s)
- Log in as **Carlos** with one click (demo logins, no sign-up).
- **Today card:** today's or the next session, with its intensity profile: warm-up, main set, cool-down
  by heart-rate zone. "The profile and every number on this page are computed by tested backend
  functions. The model never calculates anything."
- **Seven-day strip:** a dot per discipline. A purple marker means the coach has a suggestion for
  that day. Click it: the suggestion shows on the session, with **See why and decide**.
- **KPI tiles:** training load +28% vs last week, acute:chronic ratio with its 0.8–1.3 band, three
  hard days in a row, resting HR almost 5 bpm over his baseline. "This is the story the agent picked up."
- **Coach summary:** the chips are fact IDs the model cited. The backend swapped them for its own
  stored values, so a number in the text can't be made up.
- Sidebar: kilometres per discipline this week. Charts for weekly load and fitness/fatigue, each with
  a table view.

### 3. The proposal (80 s)
- Click the banner → **Proposals**.
- **Now → Proposed**: same session, shorter, and both intensity profiles side by side. You can see
  what changes before reading anything.
- The reason, then **Evidence cited** (values stored by the backend, not typed by the model) and
  **Plan impact computed by the backend**: the week's planned load before and after, inside ±10%.
- "The agent can't change the plan. It has four read-only tools and exactly one write tool, and that
  one only inserts a *pending* proposal. The ±10% weekly rule, 'only future workouts', and 'injury
  means reduce or rest' are enforced in code, in one transaction. If the model breaks a rule, the
  error goes back to it as a tool result and it corrects itself. In a real run it first proposed
  −50%, got rejected, and came back with −8%."
- **Accept** → **Calendar**: the session is marked *Updated by an accepted proposal*. The change and
  its before/after are written to `audit_log` in the same transaction.

### 4. Chat (40 s)
- Ask: **"Am I ready for my triathlon in December?"**
- The answer uses his own data, with citations: days to race, fitness trend, fatigue, sleep, his own
  note about heavy legs. "If the model cites a fact ID that doesn't exist, the backend drops it."
- If he asks to make a session easier, the chat can create a proposal, through the same guarded path.

### 5. Coach view (40 s)
- Sign out → **Elena** (coach).
- **Team ranking** from weekly aggregates only, no raw data.
- She can open any athlete's dashboard and proposals.
- **Coach review** is a per-team setting. When it's on, proposals wait in her queue first, and she can
  approve, edit the duration or reject them. In this demo team it's off.

### 6. Under the hood (50 s)
- README architecture diagram: Next.js on Vercel, Fastify API plus a pg-boss worker on Railway,
  Postgres with pgvector.
- **Async analysis:** a weekly review can take a minute or two, so `POST /analysis/run` answers right
  away and the UI polls the run. Daily jobs and post-upload checks run in the worker.
- **Separation of concerns, enforced by ESLint:** `domain/` is pure functions, routes never touch the
  database, and only one file imports each LLM SDK.
- **Two providers behind one interface:** Claude is the default. When my Anthropic account ran out of
  credits, I added Gemini as a second adapter in one file. Same loop, tools and guardrails, and it
  passed the same smoke test.
- **Tests:** 157 API tests (unit, integration on real Postgres, the agent with a scripted fake model),
  a Playwright happy path in CI, and a smoke run against the real model (16 checks, about $0.09).

---

## Part 2 — Answering the challenge questions (spoken, about 2 minutes)

Keep each answer to two or three sentences. These are the points the brief asks you to explain.

**What problem, for whom, and why this scope?**
"The users are amateur endurance athletes in a club and their coach. The problem is turning watch
data into plan adjustments that are safe and explained. I kept the scope to one loop done well:
data in, metrics, a proposal with evidence, a human decision, and the plan updated, instead of many
shallow features."

**Why Claude?**
"I needed a model that uses tools reliably: read the data first, then propose, and follow the rules
in the system prompt, like never inventing numbers or giving medical advice. Claude does that well,
it explains its reasoning clearly, and I know the SDK, prompt caching and MCP. OpenAI or Gemini
could also build this, and to prove the design isn't tied to one vendor, Gemini runs behind the same
interface."

**How is the AI used?**
"In three places. A quick check after each activity on Haiku, the cheap, fast model. A weekly review
on Sonnet. And a chat on Sonnet that answers from the athlete's own data. In all three the model
interprets and proposes. It never calculates and never acts. Cost stays low because only summaries
are sent, the rules and athlete context are cached, and runs have a turn limit."

**Why doesn't the model calculate, and why does it only propose?**
"Models are good at explaining and bad at arithmetic you can trust, so every figure comes from tested
code, and the model cites it by ID. And a plan change affects someone's health, so a person has to
accept it. The rules live in code, not in the prompt, so a prompt injection or a bad answer can't
bypass them."

**How did you approach full-stack quality?**
"Shared Zod contracts between web and API, layered backend with ESLint-enforced boundaries, migrations
and seed scripts, auth with roles, and tests at each level. It's deployed with push-to-deploy, and
the API and worker run from one Docker image."

**Product and UX decisions?**
"The athlete should see what changes before reading why: hence the before/after intensity profiles,
and the suggestion shown on the day it affects. Every number has its source, and nothing changes
without a click. I looked at how a leading triathlon app presents a session and borrowed the
patterns, but not its black-box approach: here the coach can always see the reason."

**Trade-offs, and what would you do with more time?**
"I used seed data plus FIT/GPX uploads instead of Strava, because Strava's API terms rule out AI use
and showing data to others. Session profiles are templates per workout type, since the plan doesn't
store interval structure. The open problem is judging whether a proposal is the *best* coaching
call. Today the guarantees are structural: valid, safe and cited. With more time I'd add an eval set
of labelled athlete weeks, an MCP server over the same tools, more data sources like sleep and HRV,
and streaming chat."

### Closing (10 s)
"The repo, the README and the live demo are linked below. Thanks for watching."
