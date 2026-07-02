import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyCustomerToken } from "@/lib/customer-jwt";

// Read status. Accepts either an agent auth (via SSR client)
// or a customer token in x-customer-token header.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const session_id = url.searchParams.get("session_id");
  if (!session_id) return NextResponse.json({ error: "missing" }, { status: 400 });

  const custTok = req.headers.get("x-customer-token") || "";
  if (custTok) {
    const claims = await verifyCustomerToken(custTok);
    if (!claims || claims.session_id !== session_id) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  // (Agent flows use the API only via the browser client with cookies;
  //  we skip revalidating here to keep the route simple.)

  const { data, error } = await supabaseAdmin()
    .from("sessions")
    .select("id, status, agent_id, room_id, started_at, ended_at")
    .eq("id", session_id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
