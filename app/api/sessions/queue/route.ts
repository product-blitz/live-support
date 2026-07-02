import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyCustomerToken } from "@/lib/customer-jwt";
import { pickAndRingAgent } from "@/lib/round-robin";

export async function POST(req: Request) {
  const token = req.headers.get("x-customer-token") || "";
  const claims = await verifyCustomerToken(token);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { session_id } = await req.json();
  if (session_id !== claims.session_id) {
    return NextResponse.json({ error: "session_mismatch" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  await admin
    .from("sessions")
    .update({ status: "waiting" })
    .eq("id", session_id);

  await admin.from("session_events").insert({
    session_id,
    event_type: "queued",
    actor: "customer",
  });

  const agentId = await pickAndRingAgent(session_id);
  if (!agentId) {
    return NextResponse.json({ status: "no_agents_available" }, { status: 202 });
  }
  return NextResponse.json({ status: "ringing", agent_id: agentId });
}
