"use client";

import { useState } from "react";

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

export function SupabaseSetupCard({ workspaceId = "default" }: Readonly<{ workspaceId?: string }>) {
  const [token, setToken] = useState("");
  const [projectRef, setProjectRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <article className="space-y-4 border border-zinc-800 bg-zinc-900 p-4" data-testid="supabase-setup-card">
      <div>
        <h3 className="text-sm font-medium text-zinc-100">Supabase Cloud Branching</h3>
        <p className="text-sm text-zinc-400">Connect a Supabase project for DB-relevant wave isolation.</p>
      </div>
      {message ? <output className="block text-sm text-emerald-300">{message}</output> : null}
      {error ? <p role="alert" className="text-sm text-amber-300">{error}</p> : null}
      <label className="block space-y-1 text-sm">
        <span className="text-zinc-300">Management API token</span>
        <input aria-label="Supabase Management API token" type="password" className="w-full border border-zinc-800 bg-zinc-950 p-2" value={token} onChange={(event) => setToken(event.target.value)} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="text-zinc-300">Project ref</span>
        <input aria-label="Supabase project ref" className="w-full border border-zinc-800 bg-zinc-950 p-2" value={projectRef} onChange={(event) => setProjectRef(event.target.value)} />
      </label>
      <button type="button" disabled={busy || !token.trim() || !projectRef.trim()} onClick={validate} className="border border-emerald-500 px-2 py-1 text-xs text-emerald-300 disabled:opacity-45">
        {busy ? "Validating" : "Validate Supabase"}
      </button>
    </article>
  );
}
