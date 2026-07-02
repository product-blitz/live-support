# Supabase migrations

All schema changes for `live-support` live in `migrations/` as ordered `.sql`
files. Never edit an existing migration — add a new one.

## Apply to a new Supabase project

If you're starting fresh, just paste each file in order into the Supabase SQL
Editor and run.

## Apply via Supabase CLI (recommended)

Install the CLI once:

```bash
brew install supabase/tap/supabase
```

Then, from repo root:

```bash
supabase link --project-ref <your-project-ref>   # one-time; ref is in URL
supabase db push
```

`db push` runs any new migrations not yet applied to the linked project.

## Naming convention

`YYYYMMDD_NNN_short_description.sql`

- Date prefix keeps them ordered.
- `NNN` (000, 010, 020…) leaves room to slot a fix between two files.
- Description is 2–4 words.

## What's here

- `20260702_000_initial_schema.sql` — agents, sessions, session_events,
  RLS policies, `handle_new_agent` trigger.
- `20260702_010_drop_last_ping_at.sql` — swap the 15s heartbeat column
  for `last_seen_at` (see RUN.md → Presence design).
- `20260702_020_idempotency_keys.sql` — durable idempotency store
  backup (primary is Upstash Redis).
