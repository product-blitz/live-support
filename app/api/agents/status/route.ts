import { NextResponse } from "next/server";
import { supabaseSSR, supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/log";

// Canonical agent status endpoint. Replaces the old heartbeat.
// - Accepts status in JSON body (fetch) OR text body (sendBeacon).
// - Writes agents.status and agents.last_seen_at.
// - No last_ping_at anymore (dropped by migration 20260702_010).
export async function POST(req: Request) {
  const route = "/api/agents/status";
  const start = Date.now();
  log("api.start", { route });
  try {
    const ssr = supabaseSSR();
    const { data: { user } } = await ssr.auth.getUser();
    if (!user) {
      log("api.end", { route, latency_ms: Date.now() - start, status: 401 });
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // Support both application/json and navigator.sendBeacon (text/plain).
    const raw = await req.text();
    let status: string | undefined;
    try {
      const parsed = raw ? JSON.parse(raw) : {};
      status = parsed.status;
    } catch {
      // sendBeacon may send a form-urlencoded-ish payload; not expected here
      status = undefined;
    }

    if (!status || !["online", "busy", "offline"].includes(status)) {
      log("api.end", { route, latency_ms: Date.now() - start, status: 400 });
      return NextResponse.json({ error: "bad_status" }, { status: 400 });
    }

    const admin = supabaseAdmin();
    await admin
      .from("agents")
      .update({ status, last_seen_at: new Date().toISOString() })
      .eq("auth_user_id", user.id);

    log("api.end", { route, latency_ms: Date.now() - start, status: 200, agent_status: status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    log("api.end", {
      route,
      latency_ms: Date.now() - start,
      status: 500,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
