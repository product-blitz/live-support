import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { disableHmsRoom, verifyHmsWebhook } from "@/lib/hms";
import { getRedis } from "@/lib/redis";
import { log } from "@/lib/log";

// 100ms webhook receiver.
//
// Setup: in 100ms dashboard → Developer → Webhooks, register
//   URL:    https://<your-domain>/api/hooks/hms
//   Events: session.close.success, peer.leave.success, peer.join.success
//   Signing secret → set as HMS_WEBHOOK_SECRET env var.
//
// Signature: 100ms sends HMAC-SHA256 hex in the `X-Hms-Signature` header,
// computed over the raw request body with the signing secret. See lib/hms.ts.
//
// Idempotency: 100ms may retry. We de-dupe on the payload's `id` field
// via Redis if configured.
const DEDUPE_TTL_SECONDS = 60 * 60; // 1h

type HmsEvent = {
  id?: string;
  type?: string;
  data?: {
    room_id?: string;
    session_id?: string;
    peer?: { role?: string; user_id?: string; peer_id?: string };
    [k: string]: unknown;
  };
};

export async function POST(req: Request) {
  const route = "/api/hooks/hms";
  const start = Date.now();
  log("api.start", { route });

  const rawBody = await req.text();
  const signature = req.headers.get("x-hms-signature") || "";
  if (!verifyHmsWebhook(rawBody, signature)) {
    log("hms.webhook.signature_failed", { route });
    log("api.end", { route, latency_ms: Date.now() - start, status: 401 });
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  let evt: HmsEvent;
  try {
    evt = JSON.parse(rawBody);
  } catch {
    log("api.end", { route, latency_ms: Date.now() - start, status: 400 });
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  // Idempotency
  const redis = getRedis();
  if (redis && evt.id) {
    try {
      const already = await redis.set(`hms-evt:${evt.id}`, "1", {
        ex: DEDUPE_TTL_SECONDS,
        nx: true,
      });
      if (already !== "OK") {
        log("hms.webhook.duplicate", { route, event_id: evt.id, type: evt.type });
        log("api.end", { route, latency_ms: Date.now() - start, status: 200, dedup: true });
        return NextResponse.json({ ok: true, dedup: true });
      }
    } catch {
      // best effort — proceed even if Redis unavailable
    }
  }

  const admin = supabaseAdmin();
  const roomId = evt.data?.room_id;
  const peerRole = evt.data?.peer?.role;

  log("hms.webhook.received", { route, type: evt.type, room_id: roomId, peer_role: peerRole });

  // Nothing to do without a room_id (except session.close which we handle)
  if (!roomId) {
    log("api.end", { route, latency_ms: Date.now() - start, status: 200, reason: "no_room_id" });
    return NextResponse.json({ ok: true });
  }

  const shouldClose =
    evt.type === "session.close.success" ||
    (evt.type === "peer.leave.success" && peerRole === "agent");

  if (shouldClose) {
    // Look up the session by 100ms room_id
    const { data: session } = await admin
      .from("sessions")
      .select("id, status, agent_id")
      .eq("room_id", roomId)
      .maybeSingle();

    if (!session) {
      log("hms.webhook.session_not_found", { route, room_id: roomId });
      log("api.end", { route, latency_ms: Date.now() - start, status: 200, reason: "no_session" });
      return NextResponse.json({ ok: true });
    }
    if (session.status === "completed" || session.status === "expired") {
      log("api.end", { route, latency_ms: Date.now() - start, status: 200, reason: "already_closed" });
      return NextResponse.json({ ok: true });
    }

    // Best-effort disable the room (may already be closed)
    await disableHmsRoom(roomId);

    await admin
      .from("sessions")
      .update({ status: "completed", ended_at: new Date().toISOString() })
      .eq("id", session.id);

    if (session.agent_id) {
      await admin.from("agents").update({ status: "online" }).eq("id", session.agent_id);
    }

    await admin.from("session_events").insert({
      session_id: session.id,
      event_type: "ended",
      actor: "hms_webhook",
      metadata: { hms_event_type: evt.type },
    });

    // Broadcast so any still-connected clients drop
    const ch = admin.channel(`session:${session.id}`);
    await ch.send({ type: "broadcast", event: "ended", payload: {} });
    await admin.removeChannel(ch);

    log("hms.webhook.session_closed", { route, session_id: session.id, type: evt.type });
  }

  log("api.end", { route, latency_ms: Date.now() - start, status: 200 });
  return NextResponse.json({ ok: true });
}
