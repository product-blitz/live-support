-- Presence swap (see RUN.md → "Presence design"):
-- We stop writing last_ping_at every 15s and instead maintain
-- last_seen_at, updated only on status changes + 60s soft refresh.

alter table agents drop column if exists last_ping_at;
alter table agents add column if not exists last_seen_at timestamptz;
