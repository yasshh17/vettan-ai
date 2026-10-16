# Staging and releases

Changes reach users in two steps:

```
merge PR → main ──► staging (Render + Vercel preview) ──► smoke test
                                                             │ green
          "Promote to production" workflow ◄─────────────────┘
                     │
                     ▼
          release branch ──► production (Render + Vercel)
```

- `main` deploys only to staging. Staging has its own Supabase project, keys and data.
- [`smoke.yml`](../.github/workflows/smoke.yml) waits for each `main` commit to reach staging. It then signs
  in as a test user, asks one real question and a follow-up, and checks that history saved them. It
  deletes the test conversation at the end.
- [`promote.yml`](../.github/workflows/promote.yml) moves `release` forward to `main`. It refuses unless
  CI and the smoke test both passed for that exact commit.
- Production deploys only from `release`.

## One-time setup

Do these in order. In the steps below, `<scope>` is the last part of your Vercel preview URLs (for
example `yasshh17s-projects`).

### 1. Supabase staging project
1. Create a new project named `vettan-staging` on the free plan, in the same region as production.
2. In the SQL editor, run these migrations in order: `0000`, `0001`, `0003`, `0004`, `0005`, `0006`,
   `0007`, `0008`, `0009`. **Skip `0002`.** It claims old rows for one production account and stops
   with an error when that account doesn't exist.
3. Under Authentication → URL Configuration:
   - Set **Site URL** to `https://vettan-ai-git-main-<scope>.vercel.app`.
   - Add these **Redirect URLs**: `https://vettan-ai-*-<scope>.vercel.app/**` and
     `http://localhost:3000/**`.
4. Under Authentication → Users → Add user, create the smoke test user (for example
   `smoke@<your-domain>`) with a long random password, and tick "Auto confirm". Then create your own
   login too. Leave CAPTCHA off on staging: the smoke test signs in with a password through the API.
5. From Project Settings → API, copy the project URL, the anon key and the service role key.

### 2. Staging API keys
- **OpenAI:** create a separate project called `vettan-staging` with its own key and a low monthly budget
  (for example $5).
- **Tavily:** use a second key if your plan allows it.
- Either way, the spend guard caps staging at `GLOBAL_DAILY_BUDGET_USD`, set below.

### 3. Render staging service
Create it with New → Web Service, using the same repository and settings as production, except:

| Setting | Value |
|---|---|
| Name | `vettan-ai-staging` |
| Branch | `main` |
| Instance type | Free |
| Build filters | none, because the smoke test waits for every `main` commit to deploy |

Environment variables:

| Variable | Value |
|---|---|
| `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from the staging project |
| `OPENAI_API_KEY`, `TAVILY_API_KEY` | the staging keys |
| `CORS_ORIGINS` | `http://localhost:3000` |
| `CORS_ORIGIN_REGEX` | `https://vettan-ai-[a-z0-9-]+-<scope>\.vercel\.app` |
| `GLOBAL_DAILY_BUDGET_USD` | `2` |
| `SENTRY_DSN` | same as production |
| `SENTRY_ENVIRONMENT` | `staging` |
| `ANALYTICS_ADMIN_USER_IDS` | your staging user id |

When it's up, `https://vettan-ai-staging.onrender.com/health` should show `"status": "healthy"` and a
`commit`.

### 4. Vercel environment variables
Go to Settings → Environment Variables. Each variable needs a **Production** value and a **Preview**
value. No variable should carry production values under "All environments".

| Variable | Production | Preview |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://vettan-ai.onrender.com` | `https://vettan-ai-staging.onrender.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | production project | staging project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production project | staging project |

Redeploy a preview, then sign in on it. In the browser's network tab, requests should go to
`vettan-ai-staging.onrender.com`.

### 5. GitHub settings
Go to Settings → Secrets and variables → Actions.

- **Variables:**
  - `STAGING_API_URL`: `https://vettan-ai-staging.onrender.com`
  - `STAGING_SUPABASE_URL`: the staging project URL
- **Secrets:**
  - `STAGING_SUPABASE_ANON_KEY`
  - `SMOKE_EMAIL`
  - `SMOKE_PASSWORD`

Then go to Actions → Staging smoke test → Run workflow. It must pass before you continue.

### 6. Switch production to `release`
1. Go to Actions → Promote to production → Run workflow. The first run creates the `release` branch.
2. On the Render **production** service, go to Settings → Branch and set it to `release`.
3. In Vercel, go to Settings → Git → Production Branch and set it to `release`.
4. Don't add branch protection to `release` that requires pull requests, because the promote workflow
   pushes to it directly.

### 7. Local development
Point `backend/.env` and `frontend/.env.local` at the staging project and keys. Local testing then
stops writing to production.

## Releasing a change
1. Merge the PR into `main`. Staging deploys, and **Staging smoke test** runs.
2. If the change touches the frontend, open `https://vettan-ai-git-main-<scope>.vercel.app` and try the
   affected screens. The smoke test only checks the backend.
3. Go to Actions → **Promote to production** → Run workflow.
4. Check that production `/health` shows the new `commit`.
   - The first time, also check that both Render and Vercel started a production deploy from `release`.

**Rollback:**
- On Render, go to the production service → Events, pick the previous deploy and click Rollback.
- On Vercel, go to Deployments, pick the previous production deploy and use Instant Rollback.
- Then fix forward on `main`.

## Dependency updates
- **Grouped minor and patch updates:** merge when CI is green, then release as usual.
- **Major updates:** merge one at a time. Each needs a green smoke test plus a click-through on the
  staging preview before you promote it.

## Notes
- The free Render instance sleeps when idle, so the first request takes about a minute. The smoke test
  allows for it.
- Free Supabase projects pause after a week without activity. The smoke test also runs on Mondays and
  Thursdays, which keeps staging awake.
- Each smoke run costs about $0.04, for one research question and one follow-up.
- Actions logs are public on this repository. The smoke test prints only counts, timings and error
  messages, and GitHub masks the email and password secrets.
- GitHub turns off scheduled workflows after 60 days without repository activity. If that happens,
  re-enable the smoke test under Actions.
- `/health` reports the deployed commit from Render's `RENDER_GIT_COMMIT`. It is `null` everywhere
  else.
