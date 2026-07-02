import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyCustomerToken } from "@/lib/customer-jwt";
import { createHmsAuthToken } from "@/lib/hms";

export async function POST(req: Request) {
  const tok = req.headers.get("x-customer-token") || "";
  const claims = await verifyCustomerToken(tok);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { session_id } = await req.json();
  if (session_id !== claims.session_id) {
    return NextResponse.json({ error: "session_mismatch" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: session } = await admin
    .from("sessions")
    .select("status, room_id")
    .eq("id", session_id)
    .single();

  if (!session || session.status !== "active" || !session.room_id) {
    return NextResponse.json({ error: "not_ready" }, { status: 409 });
  }

  const customer_token = await createHmsAuthToken({
    roomId: session.room_id,
    userId: `customer-${session_id}`,
    role: "customer",
  });

  return NextResponse.json({ room_id: session.room_id, customer_token });
}
