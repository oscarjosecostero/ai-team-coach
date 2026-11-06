# Deploy

Web on Vercel, API and worker on Railway, Postgres with pgvector on Railway. Each platform deploys
from GitHub, so pushing to `main` redeploys everything.

Push-to-deploy needs GitHub linked on both platforms, not just the app installed on the repo:
Railway → Account → Integrations → GitHub (connected + Railway App installed), then
`railway service source connect --repo <owner>/<repo> --branch main --service <api|worker>`;
Vercel → Account Settings → Authentication → Login Connections → GitHub, then `vercel git connect`.
Without it, a public repo still deploys once from the CLI, but pushes trigger nothing.

```
browser ──► Vercel (Next.js, web/) ──/api/* rewrite──► Railway "api" (Dockerfile, node dist/server.js)
                                                       Railway "worker" (same image, node dist/worker.js)
                                                       Railway Postgres (pgvector)
```

The browser only talks to the Vercel origin. `/api/*` is rewritten to the Railway API, so the
httpOnly session cookie is first-party and no CORS is needed.

## 1. Railway: database

1. New project → **Deploy a template** → **pgvector** (Postgres with the `vector` extension available).
2. Nothing else to do: migration `0000` runs `CREATE EXTENSION vector` when the API starts.

## 2. Railway: API service

1. **New service → GitHub repo** `oscarjosecostero/ai-team-coach`. Railway detects the root `Dockerfile`
   (check the build log starts with the Dockerfile stages, not "Railpack"; a service whose builder was
   switched to Railpack fails with "No start command detected"). After changing service settings,
   trigger a **new deployment**: "Redeploy" replays the previous deployment's settings.
2. Variables:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | reference the database's private URL: `${{pgvector.DATABASE_URL_PRIVATE}}` |
   | `JWT_SECRET` | a long random string (`openssl rand -base64 48`) |
   | `NODE_ENV` | `production` (secure cookies) |
   | `ANTHROPIC_API_KEY` | Claude API key (without it, analysis and chat return 503) |
   | `VOYAGE_API_KEY` | optional; without it note search is full-text only |
   | `GEMINI_API_KEY`, `LLM_PROVIDER` | optional second provider: `LLM_PROVIDER=gemini` uses Gemini even when `ANTHROPIC_API_KEY` is set (`auto` prefers Claude) |
   | `SEED_PASSWORD` | password of the demo accounts for the password form (demo buttons need none) |
   | `DEMO_LOGIN_ENABLED` | `true` for the public demo |

   `PORT` is set by Railway; the API listens on it.
3. Settings → Networking → **Generate domain** (this is the `API_URL` for Vercel).
   Health check path: `/health` (reports `{"status":"ok","db":"ok"}`).
4. The API **applies pending migrations on start**, before it listens.

## 3. Railway: worker service

1. **New service → same GitHub repo** (same image).
2. Settings → Deploy → **Custom start command:** `node dist/worker.js`. No public domain.
3. Variables: the same as the API, as references so secrets live in one place
   (`DATABASE_URL=${{pgvector.DATABASE_URL_PRIVATE}}`, `NODE_ENV=production`, `JWT_SECRET=${{api.JWT_SECRET}}`,
   `ANTHROPIC_API_KEY=${{api.ANTHROPIC_API_KEY}}`, `VOYAGE_API_KEY=${{api.VOYAGE_API_KEY}}`,
   `SEED_PASSWORD=${{api.SEED_PASSWORD}}`), plus:

   | Variable | Value |
   |---|---|
   | `DEMO_DAILY_RESEED` | `true`: every day at 04:00 UTC, replace all data with a fresh seed as of that day, then queue the post-activity check for every athlete (proposals waiting each morning). |

   The seed story (Carlos' three hard days, Marcos' load spike) is relative to the seed date, so
   without the daily reseed the demo slowly goes stale. The reseed also wipes anything visitors did
   (accepted proposals, uploads, chat), which is the point for a public demo.

Schedules (UTC): metrics sweep 03:00 daily, demo reseed 04:00 daily (if enabled), weekly review for
every athlete Sundays 18:00.

## 4. Seed the production database (once)

The worker's first scheduled reseed would do it at 04:00 UTC. To seed right away, either run it from
your machine against the database's public URL (Railway injects `DATABASE_URL`, which takes precedence
over `.env`; slow, a few minutes, because every insert crosses the internet):

```bash
railway run --service pgvector -- npm run db:seed --workspace api -- --reset
```

or inside the API container (`railway ssh` needs an SSH key registered with `railway ssh keys add`):

```bash
railway ssh --service api -- node dist/scripts/seed.js --reset
```

Then log in as Carlos and press **Run analysis** (or wait for the reseed's post-activity checks) to get
the first real proposal.

## 5. Vercel: web

From the dashboard: **Add New → Project** → import the GitHub repo, **Root Directory: `web`** (keep
"Include files outside the root directory" on: the app imports `@coach/contracts` from `packages/`),
and the environment variable `API_URL=https://<railway-api-domain>` for Production and Preview. It is
read **at build time** by the rewrite in `web/next.config.ts`, so redeploy after changing it.

Or with the CLI, from the repo root (what was used for the first deploy):

```bash
vercel login
vercel project create ai-team-coach
vercel link --yes --project ai-team-coach
vercel project update ai-team-coach --root-directory web --framework nextjs --node-version 24.x --yes
printf 'https://<railway-api-domain>' | vercel env add API_URL production
printf 'https://<railway-api-domain>' | vercel env add API_URL preview
vercel deploy --prod --yes          # uploads the repo minus .vercelignore (no _context/, no .env files)
vercel git connect --yes            # push-to-deploy; needs GitHub added under Account → Login Connections
```

`vercel link` appends `.env*` to `.gitignore`; drop that line (it would override `!.env.example`, and
`.env.*` already ignores `.env.local`).

Timeouts: Vercel's external rewrites wait up to 120 s for the first byte. `POST /analysis/run` answers
`202` at once (the client polls `GET /analysis/runs/:id`), so the weekly review is never cut off.
Chat is synchronous; a chat turn (Sonnet, low effort, at most 6 turns) normally finishes well within that.

## 6. Verify (Phase 5 gate)

```bash
curl https://<railway-api-domain>/health
E2E_BASE_URL=https://<vercel-domain> npx playwright test e2e/happy-path.spec.ts --project chromium   # from web/
```

Against the live site, the happy path uses whatever proposal is waiting for Carlos. If none is
waiting, it presses **Run analysis** (a real Sonnet run, a few cents) and waits for one. It accepts the
proposal, so run it after the daily reseed or reseed again afterwards.

## Local check of the production image

```bash
docker build -t coach-api .
docker run --rm -p 4000:4000 -e DATABASE_URL=... -e JWT_SECRET=... coach-api            # API
docker run --rm -e DATABASE_URL=... -e JWT_SECRET=... coach-api node dist/worker.js      # worker
docker run --rm -e DATABASE_URL=... coach-api node dist/scripts/seed.js --reset         # seed
```
