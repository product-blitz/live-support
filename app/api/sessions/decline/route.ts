import { NextResponse } from "next/server";
import { supabaseSSR, supabaseAdmin } from "@/lib/supabase-server";
import { pickAndRingAgent } from "@/lib/round-robin";

export async function POST(req: Request) {
  const ssr = supabaseSSR();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { session_id } = await req.json();
  const admin = supabaseAdmin();

  const { data: agent } = await admin
    .from("agents")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();
  if (!agent) return NextResponse.json({ error: "no_agent_row" }, { status: 400 });

  await admin
    .from("sessions")
    .update({ status: "waiting", agent_id: null })
    .eq("id", session_id)
    .eq("agent_id", agent.id);

  await admin.from("session_events").insert({
    session_id,
    event_type: "declined",
    actor: agent.id,
  });

  // Re-queue — try to pick another agent, excluding the one who just declined
  const next = await pickAndRingAgent(session_id, [agent.id]);
  return NextResponse.json({ ok: true, next_agent_id: next });
}
