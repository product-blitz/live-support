import { NextResponse } from "next/server";
import { supabaseSSR, supabaseAdmin } from "@/lib/supabase-server";
import { createHmsRoom, createHmsAuthToken } from "@/lib/hms";

export async function POST(req: Request) {
  const ssr = supabaseSSR();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { session_id } = await req.json();
  const admin = supabaseAdmin();

  const { data: agent } = await admin
    .from("agents")
    .select("id, name")
    .eq("auth_user_id", user.id)
    .single();
  if (!agent) return NextResponse.json({ error: "no_agent_row" }, { status: 400 });

  const { data: session } = await admin
    .from("sessions")
    .select("id, status, agent_id, room_id")
    .eq("id", session_id)
    .single();
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (session.agent_id && session.agent_id !== agent.id) {
    return NextResponse.json({ error: "already_taken" }, { status: 409 });
  }

  // Create the 100ms room
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

  // Set the agent busy while in the call
  await admin.from("agents").update({ status: "busy" }).eq("id", agent.id);

  // Broadcast room details to the customer's channel
  const ch = admin.channel(`session:${session_id}`);
  await ch.send({
    type: "broadcast",
    event: "connected",
    payload: { room_id: room.id, customer_token: customer_token_hms },
  });
  await admin.removeChannel(ch);

  return NextResponse.json({
    room_id: room.id,
    agent_token,
    session_id,
  });
}
