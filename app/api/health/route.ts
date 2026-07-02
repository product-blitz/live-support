import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { pingRedis, getRedis } from "@/lib/redis";

// Lightweight health check for uptime monitors (BetterStack, UptimeRobot).
// Returns 200 if all core services are reachable, 503 otherwise.
//
// Checks:
//   - db: Supabase reachable (SELECT 1 via a trivial count query)
//   - redis: Upstash reachable if configured, else 'skipped'
//   - hms_config: HMS_* env vars present (doesn't hit their API)
//   - resend_config: RESEND_* env vars present
//   - jwt_config: CUSTOMER_JWT_SECRET present
//   - hms_webhook_config: HMS_WEBHOOK_SECRET present (soft check — deploy still works without it)
export async function GET() {
  const checks: Record<string, string> = {};
  let ok = true;

  // DB check
  try {
    const admin = supabaseAdmin();
    const { error } = await admin.from("agents").select("id", { count: "exact", head: true }).limit(1);
    checks.db = error ? `fail: ${error.message}` : "ok";
    if (error) ok = false;
  } catch (e) {
    checks.db = `fail: ${e instanceof Error ? e.message : String(e)}`;
    ok = false;
  }

  // Redis check
  if (getRedis()) {
    const alive = await pingRedis();
    checks.redis = alive ? "ok" : "fail";
    if (!alive) ok = false;
  } else {
    checks.redis = "skipped";
  }

  // Config presence
  checks.hms_config =
    process.env.HMS_APP_ACCESS_KEY && process.env.HMS_APP_SECRET && process.env.HMS_TEMPLATE_ID
      ? "ok"
      : "fail";
  if (checks.hms_config === "fail") ok = false;

  checks.resend_config =
    process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL ? "ok" : "fail";
  if (checks.resend_config === "fail") ok = false;

  checks.jwt_config = process.env.CUSTOMER_JWT_SECRET ? "ok" : "fail";
  if (checks.jwt_config === "fail") ok = false;

  // Soft check: webhook secret is optional if you haven't set up 100ms webhooks yet
  checks.hms_webhook_config = process.env.HMS_WEBHOOK_SECRET ? "ok" : "not_configured";

  return NextResponse.json(
    { ok, checks, ts: new Date().toISOString() },
    { status: ok ? 200 : 503 }
  );
}
