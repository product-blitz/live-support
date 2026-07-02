import { supabaseAdmin } from "./supabase-server";

// Picks the next available agent (online, recent heartbeat) using
// last_assigned_at for round-robin fairness. Also updates the session
// row to 'ringing' and broadcasts to the agent's realtime channel.
//
// Returns the picked agent id, or null if no one is available.
export async function pickAndRingAgent(sessionId: string, exclude: string[] = []) {
  const admin = supabaseAdmin();

  // Fetch candidates. We can't easily do SELECT FOR UPDATE from PostgREST,
  // but for MVP this best-effort ordering is fine — worst case, a rare
  // race routes to a busy agent who declines and it re-queues.
  const { data: candidates, error } = await admin
    .from("agents")
    .select("id, last_assigned_at")
    .eq("status", "online")
    .gte("last_ping_at", new Date(Date.now() - 30_000).toISOString())
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
