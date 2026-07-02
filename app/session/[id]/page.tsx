"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { supabaseBrowser } from "@/lib/supabase-browser";

const CustomerRoom = dynamic(() => import("./CustomerRoom"), { ssr: false });

type Phase = "pin" | "verifying" | "waiting" | "connecting" | "room" | "ended" | "no_agents";

export default function CustomerSession({ params }: { params: { id: string } }) {
  const sessionId = params.id;
  const [phase, setPhase] = useState<Phase>("pin");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [customerToken, setCustomerToken] = useState<string | null>(null);
  const [hmsToken, setHmsToken] = useState<string | null>(null);

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPhase("verifying");
    try {
      const res = await fetch("/api/sessions/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, pin }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(labelFor(json.error));
        setPhase("pin");
        return;
      }
      setCustomerToken(json.customer_token);
      // Enter queue
      const q = await fetch("/api/sessions/queue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-customer-token": json.customer_token,
        },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const qj = await q.json();
      if (q.status === 202 || qj.status === "no_agents_available") {
        setPhase("no_agents");
        return;
      }
      setPhase("waiting");
    } catch (e: any) {
      setError(e.message);
      setPhase("pin");
    }
  }

  // Once we're waiting, subscribe for `connected` broadcast (or ended)
  useEffect(() => {
    if (phase !== "waiting" || !customerToken) return;
    const sb = supabaseBrowser();
    const ch = sb
      .channel(`session:${sessionId}`)
      .on("broadcast", { event: "connected" }, ({ payload }) => {
        setHmsToken(payload.customer_token as string);
        setPhase("room");
      })
      .on("broadcast", { event: "ended" }, () => {
        setPhase("ended");
      })
      .subscribe();

    // Fallback poll — in case we missed the broadcast (e.g., reload)
    const poll = setInterval(async () => {
      const s = await fetch(`/api/sessions/status?session_id=${sessionId}`, {
        headers: { "x-customer-token": customerToken },
      }).then((r) => r.json()).catch(() => null);
      if (s?.status === "active" && s.room_id) {
        const t = await fetch("/api/rooms/customer-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-customer-token": customerToken,
          },
          body: JSON.stringify({ session_id: sessionId }),
        }).then((r) => r.json());
        if (t.customer_token) {
          setHmsToken(t.customer_token);
          setPhase("room");
        }
      }
      if (s?.status === "completed" || s?.status === "expired") {
        setPhase("ended");
      }
    }, 4000);

    return () => {
      sb.removeChannel(ch);
      clearInterval(poll);
    };
  }, [phase, customerToken, sessionId]);

  async function endFromCustomer() {
    if (!customerToken) return;
    await fetch("/api/sessions/end", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-customer-token": customerToken,
      },
      body: JSON.stringify({ session_id: sessionId }),
    });
    setPhase("ended");
  }

  if (phase === "room" && hmsToken) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="p-3 flex justify-end bg-black/40">
          <button onClick={endFromCustomer} className="bg-red-600 rounded-md px-3 py-1.5 text-sm">
            Leave
          </button>
        </div>
        <CustomerRoom authToken={hmsToken} />
      </div>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm bg-white/5 rounded-xl p-6 space-y-4">
        {(phase === "pin" || phase === "verifying") && (
          <>
            <h1 className="text-xl font-semibold">Enter your PIN</h1>
            <p className="opacity-70 text-sm">
              Use the 6-digit PIN from your invite email.
            </p>
            <form onSubmit={submitPin} className="space-y-3">
              <input
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="w-full text-center text-2xl tracking-widest rounded-md bg-black/40 py-3 border border-white/10"
                placeholder="••••••"
              />
              <button
                disabled={phase === "verifying"}
                className="w-full bg-white text-black rounded-md py-2 font-medium disabled:opacity-50"
              >
                {phase === "verifying" ? "Verifying..." : "Continue"}
              </button>
              {error && <p className="text-yellow-300 text-sm">{error}</p>}
            </form>
          </>
        )}
        {phase === "waiting" && (
          <div className="text-center space-y-3">
            <div className="mx-auto w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            <div className="font-medium">Connecting you to a support agent…</div>
            <div className="text-sm opacity-70">Please keep this window open.</div>
          </div>
        )}
        {phase === "no_agents" && (
          <div className="text-center space-y-2">
            <div className="font-medium">No agents available</div>
            <div className="text-sm opacity-70">
              Please try again in a few minutes.
            </div>
          </div>
        )}
        {phase === "ended" && (
          <div className="text-center space-y-2">
            <div className="font-medium">Session ended</div>
            <div className="text-sm opacity-70">You can close this window.</div>
          </div>
        )}
      </div>
    </main>
  );
}

function labelFor(err?: string) {
  switch (err) {
    case "invalid_pin": return "Incorrect PIN. Try again.";
    case "expired": return "This link has expired.";
    case "closed": return "This session has already ended.";
    case "too_many_attempts": return "Too many attempts. Wait 10 minutes.";
    case "not_found": return "Session not found.";
    default: return err || "Something went wrong.";
  }
}
