import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { signCustomerToken } from "@/lib/customer-jwt";
import { getPinRatelimit } from "@/lib/redis";
import { log } from "@/lib/log";

// Distributed rate limit via Upstash. Falls back to no-limit if Redis
// isn't configured (dev without Upstash env vars).
export async function POST(req: Request) {
  const route = "/api/sessions/verify-pin";
  const start = Date.now();
  log("api.start", { route });

  const { session_id, pin } = await req.json();
  if (!session_id || !pin) {
    log("api.end", { route, latency_ms: Date.now() - start, status: 400 });
    return NextResponse.json({ ok: false, error: "missing" }, { status: 400 });
  }

  const rl = getPinRatelimit();
  if (rl) {
    const { success } = await rl.limit(`session:${session_id}`);
    if (!success) {
      log("api.end", { route, session_id, latency_ms: Date.now() - start, status: 429 });
      return NextResponse.json({ ok: false, error: "too_many_attempts" }, { status: 429 });
    }
  }

  const admin = supabaseAdmin();
  const { data: session } = await admin
    .from("sessions")
    .select("id, pin, status, expires_at")
    .eq("id", session_id)
    .single();

  if (!session) {
    log("api.end", { route, session_id, latency_ms: Date.now() - start, status: 404 });
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    log("api.end", { route, session_id, latency_ms: Date.now() - start, status: 401, reason: "expired" });
    return NextResponse.json({ ok: false, error: "expired" }, { status: 401 });
  }
  if (["completed", "expired"].includes(session.status)) {
    log("api.end", { route, session_id, latency_ms: Date.now() - start, status: 401, reason: "closed" });
    return NextResponse.json({ ok: false, error: "closed" }, { status: 401 });
  }
  if (String(session.pin) !== String(pin)) {
    log("api.end", { route, session_id, latency_ms: Date.now() - start, status: 401, reason: "invalid_pin" });
    return NextResponse.json({ ok: false, error: "invalid_pin" }, { status: 401 });
  }

  await admin.from("session_events").insert({
    session_id,
    event_type: "pin_entered",
    actor: "customer",
  });

  const customer_token = await signCustomerToken(session_id);
  log("api.end", { route, session_id, latency_ms: Date.now() - start, status: 200 });
  return NextResponse.json({ ok: true, customer_token });
}
