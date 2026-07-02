import { supabaseAdmin } from "./supabase-server";

// Picks the next available agent (online, seen recently) using
// last_assigned_at for round-robin fairness. Also updates the session
// row to 'ringing' and broadcasts to the agent's realtime channel.
//
// Presence design (see RUN.md):
//   agents.status in DB is the source of truth. The client:
//     - calls POST /api/agents/status when the status button is clicked
//     - re-pings every 60s (soft refresh of last_seen_at)
//     - sends a navigator.sendBeacon with status=offline on beforeunload
//   The `presence:agents` Realtime channel is used only for other agents'
//   visibility — not for routing decisions, to keep the picker robust to
//   Realtime hiccups.
//
// We keep a 5-minute freshness gate on last_seen_at as a safety net in
// case the beacon misses AND the tab was closed without setting offline.
//
// Returns the picked agent id, or null if no one is available.
const STALE_MS = 5 * 60 * 1000;

export async function pickAndRingAgent(sessionId: string, exclude: string[] = []) {
  const admin = supabaseAdmin();

  const { data: candidates, error } = await admin
    .from("agents")
    .select("id, last_assigned_at, last_seen_at")
    .eq("status", "online")
    .gte("last_seen_at", new Date(Date.now() - STALE_MS).toISOString())
    .order("last_assigned_at", { ascending: true, nullsFirst: true })
    .limit(20);

  if (error) throw error;
  if (!candidates || candidates.length === 0) return null;

  const pick = candidates.find((c) => !exclude.includes(c.id));
  if (!pick) return null;

  await admin
    .from("agents")
    .update({ last_assigned_at: new Date().toISOString() })
    .eq("id", pick.id);

  const { data: session } = await admin
    .from("sessions")
    .update({ status: "ringing", agent_id: pick.id })
    .eq("id", sessionId)
    .select("customer_name")
    .single();

  // Broadcast to the picked agent's channel
  const channel = admin.channel(`agent:${pick.id}`);
  await channel.send({
    type: "broadcast",
    event: "incoming",
    payload: {
      session_id: sessionId,
      customer_name: session?.customer_name ?? "Customer",
    },
  });
  await admin.removeChannel(channel);

  await admin.from("session_events").insert({
    session_id: sessionId,
    event_type: "assigned",
    actor: pick.id,
  });

  return pick.id;
}
