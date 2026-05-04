"use client";

import { useState } from "react";
import type { AppConfigView } from "@/lib/setup/types";

async function readJson(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return null; }
}

function responseMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const candidate = body as { message?: unknown; error?: unknown };
  if (typeof candidate.message === "string") return candidate.message;
  if (typeof candidate.error === "string") return candidate.error;
  return fallback;
}

export function SupabaseSetupCard({ workspaceId = "default", supabase }: Readonly<{ workspaceId?: string; supabase?: AppConfigView["supabase"] }>) {
  const [token, setToken] = useState("");
  const [projectRef, setProjectRef] = useState("");
  const [mode, setMode] = useState<"leave" | "rotate" | "disconnect">("leave");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connected = Boolean(supabase?.projectRef);

  async function validate() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/setup/supabase/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, token, projectRef }),
      });
      const body = await readJson(res);
      if (!res.ok || (body && typeof body === "object" && (body as { ok?: unknown }).ok === false)) {
        setError(responseMessage(body, "Supabase validation failed."));
        return;
      }
      const region = body && typeof body === "object" ? (body as { region?: unknown }).region : null;
      setToken("");
      setMessage(`Supabase project ${projectRef} connected${typeof region === "string" ? ` (${region})` : ""}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Supabase validation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/setup/supabase/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, surface: "setup-ui" }),
      });
      const body = await readJson(res);
      if (!res.ok || (body && typeof body === "object" && (body as { ok?: unknown }).ok === false)) {
        setError(responseMessage(body, "Supabase token rotation failed."));
        return;
      }
      setToken("");
      setMessage("Supabase Management API token rotated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Supabase token rotation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="space-y-4 border border-zinc-800 bg-zinc-900 p-4" data-testid="supabase-setup-card">
      <div>
        <h3 className="text-sm font-medium text-zinc-100">Supabase Cloud Branching</h3>
        <p className="text-sm text-zinc-400">Connect a Supabase project for DB-relevant wave isolation.</p>
      </div>
      {message ? <output className="block text-sm text-emerald-300">{message}</output> : null}
      {error ? <p role="alert" className="text-sm text-amber-300">{error}</p> : null}
      {connected ? (
        <fieldset className="space-y-2 text-sm">
          <legend className="text-zinc-300">Existing connection</legend>
          <label className="mr-3 inline-flex items-center gap-1">
            <input type="radio" name="supabase-mode" checked={mode === "leave"} onChange={() => setMode("leave")} />
            <span>Leave as is</span>
          </label>
          <label className="mr-3 inline-flex items-center gap-1">
            <input type="radio" name="supabase-mode" checked={mode === "rotate"} onChange={() => setMode("rotate")} />
            <span>Rotate Management API token</span>
          </label>
          <label className="mr-3 inline-flex items-center gap-1">
            <input type="radio" name="supabase-mode" checked={mode === "disconnect"} onChange={() => setMode("disconnect")} />
            <span>Disconnect</span>
          </label>
        </fieldset>
      ) : null}
      {connected ? (
        <div className="grid gap-2 md:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="text-zinc-300">Project ref</span>
            <input readOnly aria-label="Connected Supabase project ref" className="w-full border border-zinc-800 bg-zinc-950 p-2 text-zinc-400" value={supabase?.projectRef ?? ""} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-zinc-300">Region</span>
            <input readOnly aria-label="Connected Supabase region" className="w-full border border-zinc-800 bg-zinc-950 p-2 text-zinc-400" value={supabase?.region ?? ""} />
          </label>
        </div>
      ) : null}
      {!connected || mode === "rotate" ? (
        <>
      <label className="block space-y-1 text-sm">
        <span className="text-zinc-300">Management API token</span>
        <input aria-label="Supabase Management API token" type="password" className="w-full border border-zinc-800 bg-zinc-950 p-2" value={token} onChange={(event) => setToken(event.target.value)} />
      </label>
      {!connected ? (
      <label className="block space-y-1 text-sm">
        <span className="text-zinc-300">Project ref</span>
        <input aria-label="Supabase project ref" className="w-full border border-zinc-800 bg-zinc-950 p-2" value={projectRef} onChange={(event) => setProjectRef(event.target.value)} />
      </label>
      ) : null}
      <button type="button" disabled={busy || !token.trim() || (!connected && !projectRef.trim())} onClick={connected ? rotate : validate} className="border border-emerald-500 px-2 py-1 text-xs text-emerald-300 disabled:opacity-45">
        {busy ? "Validating" : connected ? "Rotate token" : "Validate Supabase"}
      </button>
        </>
      ) : null}
    </article>
  );
}
