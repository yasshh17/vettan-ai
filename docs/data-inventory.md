# Analytics data inventory

Every table that holds usage, analytics or consent data: what it's for, what it
holds, the legal basis, how long it's kept, who can read it and how it's deleted.
The Privacy Policy (`frontend/src/content/legal/privacy.ts`) must agree with this
file. Change both together.

**Access, for every table below:** RLS is on, `anon` and `authenticated` have no
privileges and there are no policies, so no client can read or write a row. Only
the backend, using the service role, and people with access to the Supabase
dashboard can. Reads in the dashboard or SQL editor go straight to the database,
so they can't be logged. Keep that access to the one owner account.

**Coded ID:** `actor_id` is HMAC(`ANALYTICS_ID_SECRET`, user id), cut to 32 hex
characters. Whoever holds the secret can recreate it from a user id, so it is
personal data, not anonymous data. The secret is never stored in the database.

## `product_events`

Feature usage, such as opening a chat or expanding sources.

| | |
|---|---|
| Fields | `created_at`, `actor_id`, `visit_id`, `event`, `props` (at most 512 bytes) |
| Personal data | Yes, through `actor_id` |
| Legal basis | Consent |
| Written | Only while consent is granted, checked again by the database at write time. Never for admins, with Global Privacy Control, or without a usable key |
| Retention | 90 days (nightly purge) |
| Deleted | All of a person's rows on withdrawal or account deletion |

`visit_id` is a random UUID made per page load. It exists only in the page's
memory and in rows of this table. It is never in browser storage, cookies or URLs.

No row holds question or answer text, URLs, emails, IP addresses or account ids.
Event names and props come from a fixed list. See [analytics.md](analytics.md#usage-events).

## `analytics_events`

One row per research or follow-up request: timings, counts, cost estimate,
failure stage.

| | |
|---|---|
| Fields | Event type, failure stage, timings, counts, estimated cost, allowlisted metadata, `actor_id` if consent was granted |
| Personal data | Only rows with an `actor_id` |
| Legal basis | Legitimate interests (reliability and cost). Linking a row to a person: consent |
| Retention | 90 days (nightly purge) |
| Deleted | Rows with the person's `actor_id` on withdrawal or account deletion. Rows with no `actor_id` were never linked to anyone and expire with the purge |

The legacy `user_id` and `session_id` columns were dropped by migration 0013.

## `usage_daily`

Per-person daily counters for the spend guard: cost, research, follow-up and
audio counts.

| | |
|---|---|
| Fields | `user_id`, `day`, `spend_micros`, `research_count`, `followup_count`, `audio_chars` |
| Personal data | Yes, the account id |
| Legal basis | Legitimate interests (enforcing usage limits). Not used for analytics |
| Retention | 90 days (nightly purge) |
| Deleted | With the account (`on delete cascade`) |

## `spend_daily`

Total spend across all users per day, for the global cap.

| | |
|---|---|
| Fields | `day`, `spend_micros` |
| Personal data | No |
| Retention | Not purged |

## `answer_feedback`

Thumbs up or down on an answer.

| | |
|---|---|
| Fields | `user_id`, `session_id`, `message_id`, `rating`, `is_followup`, timestamps |
| Personal data | Yes, the account id. No text |
| Legal basis | Legitimate interests (answer quality) |
| Retention | While the chat exists |
| Deleted | With the chat. On account deletion, before the account (`delete_account_content`) |

## `analytics_consent`

Each person's analytics choice, and proof of what they agreed to.

| | |
|---|---|
| Fields | `user_id`, `granted`, `decided_at`, `wording_version`, `source` (`signup`, `prompt`, `settings`), `erasure_completed_at` |
| Personal data | Yes. The choice itself is personal data |
| Legal basis | Legal obligation (being able to show consent was given) |
| Retention | While the account exists |
| Deleted | With the account (`on delete cascade`) |

## `analytics_erasure_requests`

A withdrawal or account deletion whose analytics erase hasn't finished.

| | |
|---|---|
| Fields | `user_id`, `kind`, `status`, `requested_at`, attempt count, last error code, `escalated_at` |
| Personal data | Yes, the account id |
| Legal basis | Legal obligation (carrying out the erase) |
| Retention | Until the erase finishes. A withdrawal's row is removed once its rows are erased. An account's row goes with the account |
| Deleted | As above. Stuck requests: [analytics-operations.md](analytics-operations.md#pending-erasures) |

## `analytics_key_check`

The fingerprint and state of each analytics secret, so the backend can tell a
wrong or lost key from a working one.

| | |
|---|---|
| Fields | `name` (`id`, `audit`), `fingerprint`, `state`, `epoch`, timestamps |
| Personal data | No |
| Retention | Kept |

## `analytics_purge_log`

One row per table per nightly purge run.

| | |
|---|---|
| Fields | `run_at`, `table_name`, `rows_deleted`, `oldest_remaining`, `status` |
| Personal data | No |
| Retention | 1 year |

## `analytics_access_log`

Admin reads of analytics data through the backend. Nothing writes to it yet; the
admin dashboard will.

| | |
|---|---|
| Fields | `created_at`, `admin_ref`, `key_epoch`, `action`, `params` |
| Personal data | Yes, the admin. `admin_ref` uses `ANALYTICS_AUDIT_LOG_SECRET`, so it can't be joined with `actor_id` |
| Legal basis | Legitimate interests (accountability for access) |
| Retention | 1 year |

## Access requests

`backend/scripts/export_analytics_subject.py` exports everything held for one
account, including coded rows. See
[analytics-operations.md](analytics-operations.md#access-requests).
