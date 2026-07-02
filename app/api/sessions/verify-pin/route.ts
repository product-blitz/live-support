import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { signCustomerToken } from "@/lib/customer-jwt";

// Basic in-memory rate limit (per serverless container).
// For production, back this with Upstash/Redis. Good enough for MVP.
const attempts = new Map<string, { n: number; ts: number }>();
const MAX = 5;
const WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: Request) {
  const { session_id, pin } = await req.json();
  if (!session_id || !pin) {
    return NextResponse.json({ ok: false, error: "missing" }, { status: 400 });
  }

  const key = String(session_id);
  const now = Date.now();
  const rec = attempts.get(key);
  if (rec && now - rec.ts < WINDOW_MS && rec.n >= MAX) {
    return NextResponse.json({ ok: false, error: "too_many_attempts" }, { status: 429 });
  }

  const admin = supabaseAdmin();
  const { data: session } = await admin
    .from("sessions")
    .select("id, pin, status, expires_at")
    .eq("id", session_id)
    .single();

  if (!session) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    return NextResponse.json({ ok: false, error: "expired" }, { status: 401 });
  }
  if (["completed", "expired"].includes(session.status)) {
    return NextResponse.json({ ok: false, error: "closed" }, { status: 401 });
  }
  if (String(session.pin) !== String(pin)) {
    attempts.set(key, {
      n: (rec && now - rec.ts < WINDOW_MS ? rec.n : 0) + 1,
      ts: now,
    });
    return NextResponse.json({ ok: false, error: "invalid_pin" }, { status: 401 });
  }

  attempts.delete(key);

  await admin.from("session_events").insert({
    session_id,
    event_type: "pin_entered",
    actor: "customer",
  });

  const customer_token = await signCustomerToken(session_id);
  return NextResponse.json({ ok: true, customer_token });
}
