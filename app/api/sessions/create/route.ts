import { NextResponse } from "next/server";
import { supabaseSSR, supabaseAdmin } from "@/lib/supabase-server";
import { sendCustomerInvite } from "@/lib/email";

export async function POST(req: Request) {
  const ssr = supabaseSSR();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const customer_name = String(body.customer_name || "").trim();
  const customer_email = String(body.customer_email || "").trim().toLowerCase();
  if (!customer_email) {
    return NextResponse.json({ error: "customer_email required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const pin = String(Math.floor(100000 + Math.random() * 900000));

  // Look up the caller's agent row
  const { data: agent } = await admin
    .from("agents")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  const { data: session, error } = await admin
    .from("sessions")
    .insert({
      pin,
      customer_name,
      customer_email,
      status: "pending",
      created_by: agent?.id ?? null,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const join_url = `${process.env.NEXT_PUBLIC_APP_URL}/session/${session.id}`;

  await admin.from("session_events").insert({
    session_id: session.id,
    event_type: "created",
    actor: agent?.id ?? user.id,
  });

  try {
    await sendCustomerInvite({
      to: customer_email,
      customerName: customer_name,
      pin,
      joinUrl: join_url,
    });
  } catch (e: any) {
    // Don't fail the whole request — surface the error but keep session
    return NextResponse.json({
      session_id: session.id,
      pin,
      join_url,
      email_error: e.message,
    });
  }

  return NextResponse.json({ session_id: session.id, pin, join_url });
}
