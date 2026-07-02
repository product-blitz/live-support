-- Initial schema for live-support MVP.
-- Idempotent so it can be re-run safely.

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

create table if not exists agents (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  email text unique not null,
  name text not null,
  status text not null default 'offline' check (status in ('online','busy','offline')),
  last_ping_at timestamptz,     -- legacy, dropped by migration 010
  last_assigned_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists sessions (
  id uuid primary key default uuid_generate_v4(),
  pin text not null,
  customer_name text,
  customer_email text,
  status text not null default 'pending'
    check (status in ('pending','waiting','ringing','active','completed','expired')),
  agent_id uuid references agents(id),
  room_id text,
  created_by uuid references agents(id),
  created_at timestamptz default now(),
  started_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz default (now() + interval '24 hours')
);

create index if not exists idx_sessions_status on sessions (status);
create index if not exists idx_sessions_agent_id on sessions (agent_id);
create index if not exists idx_sessions_room_id on sessions (room_id);
create index if not exists idx_agents_status on agents (status);

create table if not exists session_events (
  id bigserial primary key,
  session_id uuid references sessions(id) on delete cascade,
  event_type text not null,
  actor text,
  metadata jsonb,
  created_at timestamptz default now()
);

alter table sessions enable row level security;
alter table agents enable row level security;

do $$ begin
  create policy "agents_read_all" on agents for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "agents_update_self" on agents for update to authenticated using (auth.uid() = auth_user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "agents_sessions_all" on sessions for all to authenticated using (true);
exception when duplicate_object then null; end $$;

-- Auto-create agents row on new auth.users signup
create or replace function public.handle_new_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.agents (auth_user_id, email, name)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (email) do nothing;
  return new;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant insert on public.agents to supabase_auth_admin;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_agent();
