// DEPRECATED: kept only for backward compat with any in-flight clients.
// Prefer POST /api/agents/status.
//
// Note: last_ping_at column has been dropped (see migration 20260702_010).
// This handler now writes last_seen_at, same as /api/agents/status.
import { NextResponse } from "next/server";
import { supabaseSSR, supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/log";

export async function POST(req: Request) {
  const route = "/api/agents/heartbeat";
  const start = Date.now();
  log("api.start", { route });

  const ssr = supabaseSSR();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) {
    log("api.end", { route, latency_ms: Date.now() - start, status: 401 });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await req.text();
  let status: string | undefined;
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    status = parsed.status;
  } catch {
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

  log("api.end", { route, latency_ms: Date.now() - start, status: 200 });
  return NextResponse.json({ ok: true });
}
