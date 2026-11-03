# Analytics operations

Runbooks for the analytics secrets, the purge and stuck erasures. What's collected,
and why, is in [analytics.md](analytics.md).

## First install

Do this on staging first, then production.

1. Enable `pg_cron` under Database → Extensions if it isn't on.
2. Apply `0011_analytics_privacy.sql`.
3. Generate three values with `openssl rand -hex 32`, separately for each environment.
   Never reuse a value between environments, or between secrets.
4. Set them on the Render backend service: `ANALYTICS_ID_SECRET`,
   `ANALYTICS_AUDIT_LOG_SECRET` and `PURGE_HEALTH_TOKEN`.
5. Store a recovery copy of both secrets in your password manager, as separate entries.
6. From a trusted machine, with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set:

   ```bash
   ANALYTICS_ID_SECRET=... python backend/scripts/install_analytics_key.py id init
   ANALYTICS_AUDIT_LOG_SECRET=... python backend/scripts/install_analytics_key.py audit init
   ```

   This stores fingerprints only. Until it runs, nothing is linked and the health
   check fails.
7. Add GitHub configuration for `.github/workflows/purge-check.yml`: variables
   `STAGING_API_URL` and `PRODUCTION_API_URL`, and secrets
   `STAGING_PURGE_HEALTH_TOKEN` and `PRODUCTION_PURGE_HEALTH_TOKEN`. The production
   check fails until its two values are set, so do this before merging.

After the release is live, record your own consent, then link old rows and drop the
old identifiers:

```bash
ANALYTICS_ID_SECRET=... python backend/scripts/backfill_analytics_actor.py
```

Check the result, then apply `0012_drop_analytics_identifiers.sql`.

## Secret rules

There are two secrets: `ANALYTICS_ID_SECRET` makes coded IDs, and
`ANALYTICS_AUDIT_LOG_SECRET` makes admin references. They're independent, and the
access log can't be joined with analytics.

- Keep them on the Render backend service only. Never in Vercel, frontend code,
  Supabase, CI, the repo, logs or tickets.
- Only the backend process and the account owner can read them.
- Pass them to scripts by environment variable, never as a command-line argument.
- Local development and tests use fake values.
- Service-role database access doesn't reveal them. That separation is why a coded
  ID is worth having.

The backend compares each secret with its stored fingerprint at startup and hourly.
A missing or wrong `ANALYTICS_ID_SECRET` writes no linked rows and no product events,
never a raw account id. Essential rows continue unlinked. The stored fingerprint only
changes through this runbook, so a secret can't be replaced silently.

## Rotating `ANALYTICS_ID_SECRET`

Rotate on suspected exposure or a change in who has access. Review once a year
whether rotation is needed.

1. Set `ANALYTICS_ENABLED=false` on the backend.
2. Generate the new value, and store its recovery copy.
3. Re-key every linked row:

   ```bash
   ANALYTICS_ID_SECRET_OLD=<current> ANALYTICS_ID_SECRET=<new> \
     python backend/scripts/rekey_analytics_actor.py
   ```

4. Set the new value on Render, and `ANALYTICS_ENABLED=true`.
5. Confirm the health check passes, then remove the old recovery copy.

Emergency replacement is the same, done immediately. If the database could also have
been read, treat it as a possible breach under section 10 of the privacy policy.

## Rotating `ANALYTICS_AUDIT_LOG_SECRET`

Same triggers. Old log entries aren't re-keyed; each entry records its `key_epoch`.

```bash
ANALYTICS_AUDIT_LOG_SECRET_OLD=<current> ANALYTICS_AUDIT_LOG_SECRET=<new> \
  python backend/scripts/install_analytics_key.py audit rotate
```

Then set the new value on Render.

**If it's lost:** old entries stay readable, but can't be matched to an admin. Journeys
and admin reads of consent data stay blocked until a new value is installed:

```bash
ANALYTICS_AUDIT_LOG_SECRET=<new> python backend/scripts/install_analytics_key.py audit after_loss
```

Record the loss in this file's incident notes. It never affects coded IDs, consent,
erasure or analytics.

## Effect on `ANALYTICS_ID_SECRET` continuity

| Event | Continuity | Deletion lookup | Historical analytics |
|---|---|---|---|
| Rotation or emergency, old secret known | Kept, rows are re-keyed | Works | Kept |
| Value changed without this runbook | Blocked by the key check | Blocked until fixed | Unaffected, no new linked rows |
| Secret lost permanently | Broken for good | Impossible | All linked rows are erased |

## When the secret is unavailable

The health check reports `key_id_unavailable` and Sentry alerts daily. A backend with a
wrong or missing secret stores nothing linked and can't finish an erasure, because
erasures need the **original** secret. A new value can't find the old rows, and the key
check refuses it.

The stored fingerprint decides, per backend. So a local process connected to production
with the wrong secret raises this alert, but doesn't stop production. Production's next
key check clears it. If the alert keeps returning, look for a stray process before you
touch the secret.

If Render itself has the wrong value, restore the original from your recovery copy.
Once the key check passes, the next maintenance pass finishes every pending erasure.

## Declaring permanent loss

Only when the original secret is known to be unrecoverable. Do it as soon as that's
known. It's deliberate, and can't be undone. Nothing runs it automatically, and a fault
with a healthy key must never lead here, however long it lasts.

```bash
python backend/scripts/declare_analytics_key_lost.py I-HAVE-LOST-THE-ANALYTICS-ID-SECRET
```

This marks the key `lost`, deletes every row with a coded ID for everyone, and marks
every pending erasure as erased. The hourly task then deletes accounts waiting on
deletion. Rows with no coded ID stay, and consent choices stay, because each person's
decision still stands.

Then install a new secret:

1. Generate a new value, set it on Render, and store its recovery copy.
2. Run:

   ```bash
   ANALYTICS_ID_SECRET=<new> python backend/scripts/install_analytics_key.py id after_loss
   ```

Linked analytics restarts empty.

## Pending erasures

An erase normally finishes at once. If it can't, new linked analytics has already
stopped, and the hourly backend task retries with no attempt limit.

- **A pending withdrawal** leaves the account fully usable.
- **A pending account deletion** leaves the account disabled, with sessions revoked.
  Access is never restored, and a database trigger stops the account being deleted
  until the erase is done, because the account row holds the only copy of the id it needs.

| Oldest pending request | What happens |
|---|---|
| 24 hours | Health check fails, and Sentry alerts daily |
| 72 hours | The alert adds `erasure_stuck`: fix the fault, or if the key is unavailable, restore the secret or declare it lost |
| 7 days | Urgent: an urgent Sentry alert repeats daily, the workflow reports it, and `escalated_at` is set |

Seven days is an internal target. It's never shown to users, and it changes nothing
about the data: retries continue, and no global erase runs.

**At the urgent stage, record the cause and next step under Incident notes below.**

To see what's stuck, read `last_error_code` and `attempts` in
`analytics_erasure_requests` as the owner. It holds user ids, so don't copy it elsewhere.

## Purge and monitoring

`purge_analytics()` runs nightly through pg_cron. It deletes rows older than 90 days
from `product_events`, `analytics_events` and `usage_daily`, and writes one row per
table to `analytics_purge_log`. Purge and access logs are kept for a year. It holds no
secret, so it can't retry erasures, and it never runs a global erase.

To run it by hand on staging:

```sql
select public.purge_analytics();
select * from public.analytics_purge_log order by run_at desc limit 5;
```

Two independent checks watch it:

1. `.github/workflows/purge-check.yml` calls the health endpoint every six hours, for
   staging and production. A failed run emails you. An unreachable endpoint fails after
   three retries, rather than passing silently.
2. The backend's maintenance pass checks the same conditions and alerts through Sentry.
   It runs at startup and then hourly while the process is awake.

**A sleeping instance runs nothing until something wakes it.** A free Render instance
sleeps when idle, and a disabled account's sign-in attempts go to Supabase, so they don't
wake it. On that tier the workflow is what keeps retries going, and the second check only
covers GitHub being unable to reach the endpoint. If GitHub disables the schedule, which
it does after 60 days without repository activity, neither check runs until you re-enable
it or something else reaches the backend. An always-on instance doesn't have this gap.

| Problem code | Meaning |
|---|---|
| `purge_stale` | No successful purge for 30 hours |
| `purge_failed` | The latest purge failed for a table |
| `row_too_old` | A row in a 90-day table is over 92 days old |
| `key_id_*`, `key_audit_*` | A key is `missing`, `unavailable` or `lost` |
| `erasure_pending`, `erasure_stuck`, `erasure_urgent` | Oldest request is over 24 hours, 72 hours, 7 days |
| `health_check_failed` | The check couldn't read the database |

## Health endpoint

`GET /api/internal/analytics/purge-health` is server to server. It needs a bearer token
and refuses anything browser-shaped. Every refusal is a 404, so it doesn't reveal the
route exists. It returns codes, counts and timestamps only.

Render offers no IP allowlist on this setup, so protection is at the application layer.

**Rotating `PURGE_HEALTH_TOKEN`:** on suspected exposure, and once a year.

1. Set `PURGE_HEALTH_TOKEN_PREVIOUS` to the current value, and `PURGE_HEALTH_TOKEN` to a
   new one, on Render.
2. Update the GitHub secret.
3. Run the workflow by hand, then remove `PURGE_HEALTH_TOKEN_PREVIOUS`.

## Access requests

Coded data is personal data. For an access request from an account's owner:

```bash
ANALYTICS_ID_SECRET=... python backend/scripts/export_analytics_subject.py <user-id>
```

The output is personal data, so send it only to that person.

## Incident notes

Record each urgent escalation or key loss here: date, cause, next step, and when it was
resolved.
