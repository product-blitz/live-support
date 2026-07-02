import { NextResponse } from "next/server";
import { supabaseSSR, supabaseAdmin } from "@/lib/supabase-server";
import { createHmsRoom, createHmsAuthToken } from "@/lib/hms";
import { getRedis } from "@/lib/redis";
import { log } from "@/lib/log";

// Idempotency prevents duplicate 100ms rooms if the agent double-clicks Accept
// or the request retries on transient network errors.
//
// Strategy:
//   1. Client sends header `Idempotency-Key: <uuid>` per Accept click.
//   2. On first call, we `SET NX EX 3600 idempotency:{key} = session_id`.
//   3. On success, cache the response body under `idempotency-response:{key}`
//      with 1h TTL.
//   4. On retry (same key), return the cached response.
//   5. If Redis is unavailable, we proceed without idempotency (best-effort).
const IDEM_TTL_SECONDS = 3600;

export async function POST(req: Request) {
  const route = "/api/sessions/accept";
  const start = Date.now();
  log("api.start", { route });

  const ssr = supabaseSSR();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) {
    log("api.end", { route, latency_ms: Date.now() - start, status: 401 });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { session_id } = await req.json();
  const idemKey = req.headers.get("idempotency-key") || "";
  const redis = getRedis();

  // Idempotency: return cached response if we've handled this key before.
  if (redis && idemKey) {
    try {
      const cached = await redis.get<string>(`idempotency-response:${idemKey}`);
      if (cached) {
        log("api.end", { route, session_id, latency_ms: Date.now() - start, status: 200, idempotent: true });
        return new NextResponse(cached, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Reserve the key. If someone else already reserved it we could poll,
      // but for MVP we just proceed (worst case: two rooms; caller retries).
      await redis.set(`idempotency:${idemKey}`, session_id, {
        ex: IDEM_TTL_SECONDS,
        nx: true,
      });
    } catch (e) {
      log("idempotency.error", { route, error: e instanceof Error ? e.message : String(e) });
      // fall through — proceed without idempotency
    }
  }

  const admin = supabaseAdmin();

  const { data: agent } = await admin
    .from("agents")
    .select("id, name")
    .eq("auth_user_id", user.id)
    .single();
  if (!agent) {
    log("api.end", { route, latency_ms: Date.now() - start, status: 400, reason: "no_agent_row" });
    return NextResponse.json({ error: "no_agent_row" }, { status: 400 });
  }

  const { data: session } = await admin
    .from("sessions")
    .select("id, status, agent_id, room_id")
    .eq("id", session_id)
    .single();
  if (!session) {
    log("api.end", { route, session_id, latency_ms: Date.now() - start, status: 404 });
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (session.agent_id && session.agent_id !== agent.id) {
    log("api.end", { route, session_id, latency_ms: Date.now() - start, status: 409, reason: "already_taken" });
    return NextResponse.json({ error: "already_taken" }, { status: 409 });
  }

  const room = await createHmsRoom(session_id);
  const agent_token = await createHmsAuthToken({
    roomId: room.id,
    userId: agent.id,
    role: "agent",
  });
  const customer_token_hms = await createHmsAuthToken({
    roomId: room.id,
    userId: `customer-${session_id}`,
    role: "customer",
  });

  await admin
    .from("sessions")
    .update({
      status: "active",
      agent_id: agent.id,
      room_id: room.id,
      started_at: new Date().toISOString(),
    })
    .eq("id", session_id);

  await admin.from("session_events").insert([
    { session_id, event_type: "accepted", actor: agent.id },
    { session_id, event_type: "started", actor: agent.id },
  ]);

  await admin.from("agents").update({ status: "busy" }).eq("id", agent.id);

  const ch = admin.channel(`session:${session_id}`);
  await ch.send({
    type: "broadcast",
    event: "connected",
    payload: { room_id: room.id, customer_token: customer_token_hms },
  });
  await admin.removeChannel(ch);

  const responseBody = { room_id: room.id, agent_token, session_id };
  const responseJson = JSON.stringify(responseBody);

  // Cache the response so retries with the same idempotency key return same body.
  if (redis && idemKey) {
    try {
      await redis.set(`idempotency-response:${idemKey}`, responseJson, {
        ex: IDEM_TTL_SECONDS,
      });
    } catch {
      // best effort
    }
  }

  log("api.end", { route, session_id, latency_ms: Date.now() - start, status: 200, room_id: room.id });
  return new NextResponse(responseJson, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
