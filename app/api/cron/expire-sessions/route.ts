import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// Called by Vercel Cron every 5 min (see vercel.json).
// Marks stale sessions expired and clears ringing sessions that no one accepted.
export async function GET() {
  const admin = supabaseAdmin();
  const now = new Date().toISOString();

  await admin
    .from("sessions")
    .update({ status: "expired" })
    .lt("expires_at", now)
    .in("status", ["pending", "waiting", "ringing"]);

  // Ringing timeouts: if a session has been ringing for >30s, re-queue by
  // clearing agent_id and setting back to 'waiting'. A subsequent picker
  // call (or the next queue-poll from customer) will re-attempt.
  const ringingCutoff = new Date(Date.now() - 30_000).toISOString();
  await admin
    .from("sessions")
    .update({ status: "waiting", agent_id: null })
    .eq("status", "ringing")
    .lt("started_at", ringingCutoff); // safe no-op if started_at null

  return NextResponse.json({ ok: true });
}
