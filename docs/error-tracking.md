# Error tracking

Vettan reports errors to [Sentry](https://sentry.io) from the backend (FastAPI on
Render) and the frontend (Next.js on Vercel). Both sides are off until a DSN is
set, so local development and CI send nothing.

Per-request timings, failure stages and cost already live in product analytics
([analytics.md](analytics.md)). Sentry adds what analytics can't show: the stack
trace of each failure, how many people it affects, and an alert when it starts.

- Backend: [`backend/utils/observability.py`](../backend/utils/observability.py), tests in [`test_observability.py`](../backend/tests/test_observability.py)
- Frontend: [`frontend/src/lib/sentry.ts`](../frontend/src/lib/sentry.ts), [`instrumentation-client.ts`](../frontend/src/instrumentation-client.ts), [`instrumentation.ts`](../frontend/src/instrumentation.ts), [`global-error.tsx`](../frontend/src/app/global-error.tsx), tests in [`sentry-scrub.test.ts`](../frontend/src/__tests__/sentry-scrub.test.ts)

## What is and isn't sent

Same rule as the audit log and analytics: **no question text, answers, titles,
emails, IP addresses, cookies or tokens leave the app.**

| Sent | Never sent |
|---|---|
| Exception type and stack trace | Exception messages (they can quote input, e.g. JSON parse errors) |
| Route or page path, without query string | Request and response bodies, query strings |
| Browser and device type (User-Agent) | Authorization, Cookie, Referer, X-Forwarded-For headers |
| Salted hash of the user id (counts affected users) | Raw user id, email, IP address |
| Timing spans for a sample of requests | Log lines (many quote the question), local variables |

How that is enforced:

- **Backend.** `send_default_pii=False`, `include_local_variables=False`,
  request bodies never read. Only the FastAPI, Starlette and httpx integrations
  are on: Redis spans would carry raw IPs from rate-limit keys, and the OpenAI
  integration can record prompts. The logging integration is off. Endpoints
  report the exceptions they catch with `observability.capture(e)` instead.
  `scrub_event` strips anything left before an event or transaction is sent.
- **Frontend.** Sentry JS v11 removed `sendDefaultPii`; `dataCollection` is set
  explicitly to collect nothing about the person. `beforeSend`, `beforeSendSpan`
  and `beforeBreadcrumb` strip anything left. Session Replay is not enabled.
  `sentryOptions` uses `satisfies BrowserOptions`, so an option the SDK drops
  becomes a type error instead of being silently ignored.
- **Browser traffic** goes to `/monitoring` on the site's own origin and is
  forwarded to Sentry, so the CSP needs no Sentry host. The route exists only
  when `NEXT_PUBLIC_SENTRY_DSN` is set, and `proxy.ts` skips it.

The tests put a marker string in bodies, headers, query strings, exception
messages, log lines and span URLs, and fail if it reaches anything sent to
Sentry. The backend test does this through a real failing endpoint.

## Setup

1. **Create two Sentry projects**: one Python (FastAPI) and one Next.js. Copy
   each project's DSN.
2. **In each project, under Settings → Security & Privacy**, turn on
   *Prevent Storing of IP Addresses* and *Data Scrubber*. The app already sends
   no IPs; this covers anything added later.
3. **Backend (Render → Environment):**

   | Variable | Default | Purpose |
   |---|---|---|
   | `SENTRY_DSN` | empty | Python project DSN. Empty turns error tracking off. |
   | `SENTRY_ENVIRONMENT` | `production` | Separates staging from production in Sentry. |
   | `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Share of requests traced (0 to 1). `/` and `/health` are never traced. |
   | `AUDIT_IP_SALT` | empty | Already used by the audit log. Also salts the user-id hash. Set it to a random string. |

   The release is taken from `RENDER_GIT_COMMIT`, which Render sets.

4. **Frontend (Vercel → Settings → Environment Variables):**

   | Variable | Purpose |
   |---|---|
   | `NEXT_PUBLIC_SENTRY_DSN` | Next.js project DSN. Empty turns error tracking and the `/monitoring` route off. |
   | `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Optional. Defaults to Vercel's environment (`production`, `preview`). |
   | `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | Optional. Defaults to `0.1`. |
   | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Optional. Upload source maps at build time so stack traces show original code. Without them the build still works. |

   Public variables are baked in at build time, so redeploy after setting them.

5. **Alerts** (Sentry → Alerts):
   - a new issue in either project;
   - error count above a threshold in 5 minutes;
   - a backend event with the message `Global spend passed the alert threshold`,
     sent once a day when research spend reaches the spend guard's alert fraction.

6. **Check it.** In the browser console on the live site, run
   `setTimeout(() => { throw new Error("sentry test") })`. An `Error` issue with
   an empty message and a stack trace should appear within a minute,
   and the Network tab should show a POST to `/monitoring`, not to `sentry.io`.

## Retention

Sentry keeps events for 30 days on the free plan and 90 days on paid plans. The
Privacy Policy states `ERROR_REPORT_RETENTION_DAYS` from
[`frontend/src/content/legal/meta.ts`](../frontend/src/content/legal/meta.ts);
keep it in line with the plan.
