"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const sb = supabaseBrowser();
    try {
      if (mode === "signup") {
        const { error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("Account created. You can now sign in.");
        setMode("signin");
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = "/agent";
      }
    } catch (err: any) {
      setMsg(err.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 bg-white/5 p-6 rounded-xl">
        <h1 className="text-xl font-semibold">
          Agent {mode === "signup" ? "Sign up" : "Sign in"}
        </h1>
        <input
          type="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md bg-black/40 px-3 py-2 outline-none border border-white/10"
        />
        <input
          type="password"
          required
          minLength={6}
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md bg-black/40 px-3 py-2 outline-none border border-white/10"
        />
        <button
          disabled={busy}
          className="w-full bg-white text-black rounded-md py-2 font-medium disabled:opacity-50"
        >
          {busy ? "Working..." : mode === "signup" ? "Create account" : "Sign in"}
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
          className="w-full text-sm opacity-70 underline"
        >
          {mode === "signup" ? "Have an account? Sign in" : "New agent? Sign up"}
        </button>
        {msg && <p className="text-sm text-yellow-300">{msg}</p>}
      </form>
    </main>
  );
}
