"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { supabaseBrowser } from "@/lib/supabase-browser";

const AgentRoom = dynamic(() => import("./AgentRoom"), { ssr: false });

type Status = "online" | "busy" | "offline";
type Incoming = { session_id: string; customer_name: string };

// Random UUID for idempotency-key generation (browser-side).
function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function AgentDashboard() {
  const [agentId, setAgentId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("offline");
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [active, setActive] = useState<{ session_id: string; room_id: string; agent_token: string } | null>(null);
  const [pinInfo, setPinInfo] = useState<{ pin: string; join_url: string; email_error?: string } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const softPingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load auth + agent row on mount
  useEffect(() => {
    const sb = supabaseBrowser();
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) {
        window.location.href = "/agent/login";
        return;
      }
      setEmail(user.email ?? null);
      const { data: agent } = await sb
        .from("agents")
        .select("id, status")
        .eq("auth_user_id", user.id)
        .single();
      if (agent) {
        setAgentId(agent.id);
        setStatus(agent.status as Status);
      }
    })();
  }, []);

  // Presence + soft-refresh + beforeunload beacon.
  // - Presence: track on `presence:agents` for other agents' visibility.
  // - Soft refresh: every 60s hit /api/agents/status to keep last_seen_at fresh.
  //   (Much less than the old 15s heartbeat.)
  // - Beacon: on tab close, POST offline via sendBeacon so DB state is accurate.
  useEffect(() => {
    if (softPingRef.current) {
      clearInterval(softPingRef.current);
      softPingRef.current = null;
    }
    if (status === "offline" || !agentId) return;

    const sb = supabaseBrowser();
    const ch = sb.channel("presence:agents", {
      config: { presence: { key: agentId } },
    });
    ch.on("presence", { event: "sync" }, () => {
      // No-op for now — future: show "N agents online" in the UI.
    })
      .subscribe(async (s) => {
        if (s === "SUBSCRIBED") {
          await ch.track({ agent_id: agentId, status, since: Date.now() });
        }
      });

    // Soft refresh so last_seen_at doesn't get stale in DB.
    const softPing = () =>
      fetch("/api/agents/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).catch(() => {});
    softPingRef.current = setInterval(softPing, 60_000);

    // Beacon on tab close — mark offline server-side. sendBeacon uses text/plain.
    const onUnload = () => {
      try {
        const body = JSON.stringify({ status: "offline" });
        navigator.sendBeacon("/api/agents/status", new Blob([body], { type: "application/json" }));
      } catch {
        // best effort
      }
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);

    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
      if (softPingRef.current) clearInterval(softPingRef.current);
      ch.untrack().catch(() => {});
      sb.removeChannel(ch);
    };
  }, [status, agentId]);

  // Subscribe to incoming ring channel
  useEffect(() => {
    if (!agentId) return;
    const sb = supabaseBrowser();
    const ch = sb
      .channel(`agent:${agentId}`)
      .on("broadcast", { event: "incoming" }, ({ payload }) => {
        setIncoming(payload as Incoming);
      })
      .subscribe();

    // Also check for any in-flight ringing session on mount (in case we
    // reloaded and missed the broadcast).
    (async () => {
      const { data } = await sb
        .from("sessions")
        .select("id, customer_name")
        .eq("agent_id", agentId)
        .eq("status", "ringing")
        .maybeSingle();
      if (data) setIncoming({ session_id: data.id, customer_name: data.customer_name ?? "Customer" });
    })();

    return () => {
      sb.removeChannel(ch);
    };
  }, [agentId]);

  async function setMyStatus(next: Status) {
    setStatus(next);
    await fetch("/api/agents/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
  }

  async function accept() {
    if (!incoming) return;
    const idempotencyKey = uuid();
    const res = await fetch("/api/sessions/accept", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ session_id: incoming.session_id }),
    });
    const json = await res.json();
    if (res.ok) {
      setActive({
        session_id: incoming.session_id,
        room_id: json.room_id,
        agent_token: json.agent_token,
      });
      setIncoming(null);
      setStatus("busy");
    } else {
      alert(json.error || "Accept failed");
      setIncoming(null);
    }
  }

  async function decline() {
    if (!incoming) return;
    await fetch("/api/sessions/decline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: incoming.session_id }),
    });
    setIncoming(null);
  }

  async function endActive() {
    if (!active) return;
    await fetch("/api/sessions/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: active.session_id }),
    });
    setActive(null);
    setStatus("online");
  }

  async function createSession(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setPinInfo(null);
    try {
      const res = await fetch("/api/sessions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName,
          customer_email: customerEmail,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Create failed");
      setPinInfo({ pin: json.pin, join_url: json.join_url, email_error: json.email_error });
      setCustomerName("");
      setCustomerEmail("");
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    window.location.href = "/agent/login";
  }

  if (active) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="p-3 flex justify-between items-center bg-black/40">
          <div>Session {active.session_id.slice(0, 8)}</div>
          <button onClick={endActive} className="bg-red-600 rounded-md px-3 py-1.5 text-sm">
            End session
          </button>
        </div>
        <AgentRoom authToken={active.agent_token} />
      </div>
    );
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Agent Dashboard</h1>
          <p className="opacity-60 text-sm">{email}</p>
        </div>
        <button onClick={signOut} className="text-sm opacity-70 underline">Sign out</button>
      </header>

      <section className="bg-white/5 rounded-xl p-5 space-y-3">
        <div className="text-sm opacity-70">Your status</div>
        <div className="flex gap-2">
          {(["online", "busy", "offline"] as Status[]).map((s) => (
            <button
              key={s}
              onClick={() => setMyStatus(s)}
              className={`px-4 py-2 rounded-md text-sm ${
                status === s ? "bg-white text-black" : "bg-black/30 border border-white/10"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      <section className="bg-white/5 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm opacity-70">New support session</div>
          <button
            onClick={() => setShowNew(!showNew)}
            className="text-sm underline opacity-70"
          >
            {showNew ? "Hide" : "Create"}
          </button>
        </div>
        {showNew && (
          <form onSubmit={createSession} className="space-y-2">
            <input
              placeholder="Customer name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full rounded-md bg-black/40 px-3 py-2 border border-white/10"
            />
            <input
              type="email"
              required
              placeholder="Customer email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              className="w-full rounded-md bg-black/40 px-3 py-2 border border-white/10"
            />
            <button
              disabled={busy}
              className="bg-white text-black rounded-md px-4 py-2 font-medium disabled:opacity-50"
            >
              {busy ? "Creating..." : "Send invite"}
            </button>
          </form>
        )}
        {pinInfo && (
          <div className="mt-2 text-sm space-y-1">
            <div>PIN: <b className="tracking-widest">{pinInfo.pin}</b></div>
            <div>
              Link:{" "}
              <a href={pinInfo.join_url} target="_blank" className="underline break-all">
                {pinInfo.join_url}
              </a>
            </div>
            {pinInfo.email_error && (
              <div className="text-yellow-300">Email failed: {pinInfo.email_error}</div>
            )}
          </div>
        )}
      </section>

      {incoming && (
        <div className="fixed bottom-6 right-6 bg-black border border-white/20 rounded-xl p-4 shadow-xl w-80">
          <div className="text-sm opacity-70">Incoming session</div>
          <div className="font-medium mt-1">{incoming.customer_name}</div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={accept}
              className="flex-1 bg-green-500 text-black rounded-md py-2 font-medium"
            >
              Accept
            </button>
            <button
              onClick={decline}
              className="flex-1 bg-white/10 rounded-md py-2"
            >
              Decline
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
