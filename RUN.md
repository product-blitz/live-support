# Live Support — Local Run + Deploy

This is a Next.js 14 App Router project. Every file you need is already in this folder.

---

## 1. Install dependencies

```bash
cd "/Users/shreyansh/Documents/Claude/Projects/Live connection"
npm install
```

If npm complains about peer deps, use `npm install --legacy-peer-deps`.

---

## 2. Create .env.local

Copy the example and fill in your values:

```bash
cp .env.local.example .env.local
```

Open `.env.local` and paste each value from your local notes file. All 11 vars must be set:

- Supabase (3)
- 100ms (4)
- Resend (2)
- App URL + JWT secret (2)

---

## 3. Run locally

```bash
npm run dev
```

Open http://localhost:3000

Flow to test:
1. Visit http://localhost:3000/agent → redirects to `/agent/login`
2. Click **New agent? Sign up**, use your work email + a password (min 6 chars)
3. After signup, sign in with the same credentials
4. You'll land on the dashboard. Confirm your row appears in Supabase → Table Editor → `agents`
5. Toggle status to **online** (a green pill)
6. Click **New support session** → enter your OWN email as customer, click **Send invite**
7. Copy the PIN + link that shows up
8. Open the link in a **different browser** (or Incognito) → enter the PIN
9. Back in the agent tab, an incoming toast appears → click **Accept**
10. Both windows should land in a 100ms room within ~5 seconds

---

## 4. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit: live support MVP"
git branch -M main

# Replace with your repo URL from GitHub
git remote add origin https://github.com/product-blitz/live-support.git
git push -u origin main
```

`.env.local` is git-ignored — your secrets will NOT be pushed.

---

## 5. Deploy to Vercel

```bash
vercel
```

Follow the prompts:
- Set up and deploy? **Y**
- Which scope? your personal account
- Link to existing project? **N**
- Project name? `live-support`
- In which directory is your code? `./`
- Override settings? **N**

Then add env vars in the Vercel dashboard:
1. Go to https://vercel.com/dashboard → click your `live-support` project → **Settings → Environment Variables**
2. Add each of the 11 vars from your `.env.local` (except `NEXT_PUBLIC_APP_URL` — set that to your Vercel URL, e.g., `https://live-support-xxx.vercel.app`)
3. Redeploy: `vercel --prod`

---

## 6. Update Supabase URL config for production

After deploy, go to Supabase → Authentication → URL Configuration:
- **Site URL**: your Vercel URL (e.g., `https://live-support-xxx.vercel.app`)
- **Redirect URLs**: add `https://live-support-xxx.vercel.app/**`

---

## 7. Enable Realtime broadcast

Supabase Realtime broadcast works out of the box for any channel name. No config needed.

If you see channel messages not arriving:
- Confirm you're using the **same** Supabase project on both client and server
- Confirm you didn't disable Realtime in Project Settings

---

## 8. Smoke-test checklist

- [ ] Agent A signs up → row in `agents`
- [ ] Agent A signs in → dashboard loads
- [ ] Agent A toggles online → `last_ping_at` updates in DB
- [ ] Agent creates session → email arrives at customer address
- [ ] Customer link + PIN works → waiting screen appears
- [ ] Wrong PIN → error message; correct PIN → advances
- [ ] Agent A sees "Incoming session" toast
- [ ] Agent A clicks Accept → both parties in a 100ms room within ~5s
- [ ] Video, audio, screen share, chat all work
- [ ] Either party clicks End/Leave → both drop out
- [ ] `sessions` row shows `status='completed'`, `ended_at` set
- [ ] Two agents online → sessions alternate (round-robin)
- [ ] Agent B declines → session re-routes to Agent A
- [ ] Agent offline → not picked
- [ ] Link older than 24h → shows "expired"

---

## Known gotchas

- **Resend free tier only sends to your signup email** until you verify a domain. For MVP testing, put your own email as the "customer email".
- **100ms 10,000 free minutes/month**. Roughly 400 minutes/day is your ceiling. Monitor usage in the 100ms dashboard.
- **iOS Safari does not support screen share in-browser.** Video + audio + chat still work.
- **Vercel Hobby has 10-second serverless function timeout.** All routes here complete well under that.
- **Ringing timeouts are best-effort.** If an agent never accepts, the cron re-queues after ~30s next time it runs. For a tighter UX, add a client-side timeout that calls `/api/sessions/decline` after 20s of ringing.
- **Concurrent picker race.** For MVP the round-robin picker uses PostgREST (no SELECT FOR UPDATE). Very rare cases where two customers ring the same agent at exactly the same instant — worst case, one gets declined and re-queues.
