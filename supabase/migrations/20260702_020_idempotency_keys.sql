-- Idempotency store fallback for when Redis isn't available.
-- The Accept API uses Redis by default; this table is a durable backup.

create table if not exists idempotency_keys (
  key text primary key,
  session_id uuid references sessions(id) on delete cascade,
  response jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_idempotency_keys_created_at
  on idempotency_keys (created_at);
