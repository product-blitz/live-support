import { NextResponse } from "next/server";
import { supabaseSSR, supabaseAdmin } from "@/lib/supabase-server";

export async function POST(req: Request) {
  const ssr = supabaseSSR();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { status } = await req.json();
  if (!["online", "busy", "offline"].includes(status)) {
    return NextResponse.json({ error: "bad_status" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  await admin
    .from("agents")
    .update({ status, last_ping_at: new Date().toISOString() })
    .eq("auth_user_id", user.id);

  return NextResponse.json({ ok: true });
}
