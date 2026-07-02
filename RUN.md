# Live Support — Local Run + Deploy

Next.js 14 App Router project. Every file you need is already in this folder.

---

## Quick start

```bash
cd "/Users/shreyansh/Documents/Claude/Projects/Live connection"
npm install
cp .env.local.example .env.local
# ... fill in values in .env.local (see sections below) ...
npm run dev
```

Open http://localhost:3000/agent → sign up → toggle online → create session → test flow.

---

## Environment variables

There are 4 categories. **Bold** are required to run at all; others enable
production-grade features but the app still works without them.

**Supabase — required**
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

**100ms — required for video**
- `HMS_APP_ACCESS_KEY`, `HMS_APP_SECRET`, `HMS_TEMPLATE_ID`, `HMS_SUBDOMAIN`
- `HMS_WEBHOOK_SECRET` — optional, but without it `/api/hooks/hms` rejects all webhooks

**Resend — required for email**
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`

**App core — required**
- `NEXT_PUBLIC_APP_URL`, `CUSTOMER_JWT_SECRET`

**Upstash Redis — optional (recommended)**
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- If unset: rate limits + idempotency are disabled (logged warning)

**Sentry — optional (recommended)**
- `NEXT_PUBLIC_SENTRY_DSN`
- If unset: errors go only to Vercel logs
- `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` are only needed if you
  enable source-map upload in `next.config.js` (currently disabled)

---

## Deploy to Vercel

```bash
vercel                            # first time — follow prompts
vercel --prod                     # subsequent deploys
```

Add all env vars in Vercel dashboard → Settings → Environment Variables.
**Tick Production + Preview + Development for each.**

`NEXT_PUBLIC_APP_URL` on Vercel = your Vercel URL, not `localhost:3000`.

---

## Post-deploy configuration

### Supabase → Auth → URL Configuration
- Site URL: your Vercel URL
- Redirect URLs: `https://your-app.vercel.app/**`

### 100ms → Developer → Webhooks
- Add endpoint: `https://your-app.vercel.app/api/hooks/hms`
- Events to send: `session.close.success`, `peer.leave.success`, `peer.join.success`
- Copy the signing secret → set as `HMS_WEBHOOK_SECRET` in Vercel

### BetterStack (or UptimeRobot)
- Add HTTP monitor: `https://your-app.vercel.app/api/health`
- Interval: 3 min. Alerts on 5xx or timeout.

### Sentry
- Sign up → create Next.js project → copy DSN → paste as `NEXT_PUBLIC_SENTRY_DSN`

---

## Database migrations

Schema is versioned in `supabase/migrations/`. See `supabase/README.md`.

To apply:
- **New project:** paste each file into Supabase SQL Editor in order.
- **Existing project:** `supabase link --project-ref <ref>` then `supabase db push`.

Never edit an old migration — add a new one.

---

## Architecture reference

### Presence design

`agents.status` in Postgres is the **source of truth** for routing.

The client keeps DB state fresh with three signals, in order of importance:

1. **On every status button click** → `POST /api/agents/status` (writes status + `last_seen_at`).
2. **Every 60s while online** → soft refresh POST to the same endpoint. Prevents `last_seen_at` from getting stale.
3. **`beforeunload` / `pagehide` beacon** → `navigator.sendBeacon` sets status to `offline` when the tab closes. Best effort — some browsers drop it.

The `presence:agents` Supabase Realtime channel is used only for other agents' visibility (nice-to-have UI, not routing).

`pickAndRingAgent` filters by `status='online' AND last_seen_at > now() - 5 min`. The 5-min window catches cases where the beacon didn't fire and the browser was force-killed.

**Why not fully realtime presence?** Supabase Presence server-side inspection needs an additional subscribe + wait cycle per pick, which slows routing. The DB-based approach is simple, robust, and adequate up to hundreds of agents.

### Idempotency

`POST /api/sessions/accept` accepts an `Idempotency-Key` header. On duplicate keys (retries, double-clicks), we return the cached response instead of creating a second 100ms room. Cache lives in Upstash Redis with 1h TTL. Falls back to no-op if Redis is unavailable.

### Webhook handler

`POST /api/hooks/hms` verifies HMAC-SHA256 signature (using `HMS_WEBHOOK_SECRET`) and auto-closes orphaned sessions on `session.close.success` or `peer.leave.success` (agent role). Dedup via Redis on `event.id`.

### Structured logs

Every API route emits `event: 'api.start'` and `event: 'api.end'` JSON lines with trace_id, session_id, latency_ms, and status. Grep Vercel logs by `session_id` to debug a single call.

### Health check

`GET /api/health` — 200 if DB, Redis, and config env vars all check out; 503 otherwise. Wire to BetterStack for uptime alerts.

---

## Smoke test checklist

- [ ] Sign up → row in `agents` table (via `handle_new_agent` trigger)
- [ ] Sign in → dashboard loads, presence-tracked
- [ ] Toggle online → `agents.status='online'`, `last_seen_at` updates
- [ ] Create session with own email → email arrives, PIN + link shown
- [ ] Customer opens link (Incognito) → PIN entry → waiting screen
- [ ] Wrong PIN → error; after 5 wrong → 429 rate-limited (needs Upstash configured)
- [ ] Correct PIN → agent tab shows Incoming toast
- [ ] Accept → both parties in 100ms room within 5s
- [ ] Double-click Accept → still only one room (idempotency)
- [ ] Close agent tab mid-call → session auto-closes within ~30s (needs webhook configured)
- [ ] Click End → both drop, `sessions.status='completed'`
- [ ] Two agents online → sessions alternate (round-robin)
- [ ] Decline → routes to next agent
- [ ] Offline agent → not picked
- [ ] Link older than 24h → "expired"
- [ ] `GET /api/health` → 200 with all checks 'ok'

---

## Known gotchas

- **Resend free tier only sends to your signup email** until domain verified.
- **100ms 10K free min/month.** Monitor in 100ms dashboard.
- **iOS Safari can't screen share in-browser.** Video/audio/chat work.
- **Vercel Hobby cron limit** — daily only. See `vercel.json`.
- **Beacon on tab close is best-effort.** Rely on webhook + 5-min stale filter for reliability.
- **Concurrent picker race.** Very rare; retry via decline works.

---

## Post-MVP additions (in priority order)

1. Session recording (100ms feature flag)
2. Remote control (RustDesk bolt-on)
3. Skill / department routing
4. Post-session survey email
5. Analytics dashboard
6. Customer-initiated sessions (widget on your site)
