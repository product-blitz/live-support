import { NextResponse } from "next/server";
import { supabaseSSR, supabaseAdmin } from "@/lib/supabase-server";
import { verifyCustomerToken } from "@/lib/customer-jwt";
import { disableHmsRoom } from "@/lib/hms";

// Either an authenticated agent OR a customer with a valid session token
// can end a session.
export async function POST(req: Request) {
  const { session_id } = await req.json();
  if (!session_id) {
    return NextResponse.json({ error: "missing" }, { status: 400 });
  }

  const ssr = supabaseSSR();
  const { data: { user } } = await ssr.auth.getUser();
  const custTok = req.headers.get("x-customer-token") || "";
  const custClaims = custTok ? await verifyCustomerToken(custTok) : null;

  if (!user && (!custClaims || custClaims.session_id !== session_id)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: session } = await admin
    .from("sessions")
    .select("room_id, agent_id, status")
    .eq("id", session_id)
    .single();
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (session.room_id) await disableHmsRoom(session.room_id);

  await admin
    .from("sessions")
    .update({ status: "completed", ended_at: new Date().toISOString() })
    .eq("id", session_id);

  if (session.agent_id) {
    await admin.from("agents").update({ status: "online" }).eq("id", session.agent_id);
  }

  await admin.from("session_events").insert({
    session_id,
    event_type: "ended",
    actor: user ? "agent" : "customer",
  });

  // Broadcast so both clients drop the room
  const ch = admin.channel(`session:${session_id}`);
  await ch.send({ type: "broadcast", event: "ended", payload: {} });
  await admin.removeChannel(ch);

  return NextResponse.json({ ok: true });
}
