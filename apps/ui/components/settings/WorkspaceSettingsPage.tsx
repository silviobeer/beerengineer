"use client";

import { useState } from "react";
import { SupabaseReadinessSummary } from "./SupabaseReadinessSummary";
import type { SupabaseReadinessSnapshot } from "@/lib/setup/types";

function messageFrom(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const candidate = body as { message?: unknown; error?: unknown };
  return typeof candidate.message === "string" ? candidate.message : typeof candidate.error === "string" ? candidate.error : fallback;
}

export function WorkspaceSettingsPage({
  workspaceKey,
  workspaceName,
  initialReadiness,
}: Readonly<{
  workspaceKey: string;
  workspaceName?: string;
  initialReadiness: SupabaseReadinessSnapshot;
}>) {
  const [readiness, setReadiness] = useState(initialReadiness);
  const [projectRef, setProjectRef] = useState(initialReadiness.workspace.projectRef ?? "");
  const [token, setToken] = useState("");
  const [branchMode, setBranchMode] = useState<"create" | "attach">("create");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connected = Boolean(readiness.workspace.projectRef);
  const dbMode = readiness.workspace.dbMode;
  const isDirectMode = connected && dbMode === "direct";

  async function refreshReadiness(): Promise<SupabaseReadinessSnapshot | null> {
    const query = readiness.retry.runId ? `?runId=${encodeURIComponent(readiness.retry.runId)}` : "";
    const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceKey)}/supabase/readiness${query}`, { cache: "no-store" });
    const body = await res.json().catch(() => null) as { readiness?: SupabaseReadinessSnapshot } | null;
    if (!res.ok || !body?.readiness) return null;
    setReadiness(body.readiness);
    setProjectRef(body.readiness.workspace.projectRef ?? projectRef);
    return body.readiness;
  }

  async function connect() {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceKey)}/supabase/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "ignored-by-engine", projectRef, token }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.ok === false) {
      setError(messageFrom(body, "Supabase project could not be connected."));
      return;
    }
    setToken("");
    setMessage("Supabase project connected.");
    await refreshReadiness();
  }

  async function rotate() {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceKey)}/supabase/rotate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.ok === false) {
      setError(messageFrom(body, "Supabase token could not be rotated."));
      return;
    }
    setToken("");
    setMessage("Supabase Management API token rotated.");
    await refreshReadiness();
  }

  async function setupBranch() {
    setError(null);
    setMessage("checking persistent test branch...");
    const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceKey)}/supabase/branch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: branchMode }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.ok === false) {
      setError(messageFrom(body, "Persistent test branch still needs recheck."));
      await refreshReadiness();
      return;
    }
    setMessage(`Persistent test branch ${branchMode === "attach" ? "attached" : "created"}.`);
    await refreshReadiness();
  }

  async function retryRun(): Promise<SupabaseReadinessSnapshot | void> {
    if (!readiness.retry.runId) return;
    await fetch(`/api/runs/${encodeURIComponent(readiness.retry.runId)}/supabase-readiness/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "Supabase readiness setup updated." }),
    });
    return await refreshReadiness() ?? undefined;
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 overflow-x-hidden" data-testid="workspace-settings-page">
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-3">
          <p className="font-mono text-xs uppercase text-zinc-500">/w/{workspaceKey}/settings</p>
          <h1 className="font-display text-2xl">Workspace settings</h1>
          <p className="text-sm text-zinc-400">{workspaceName ?? workspaceKey}</p>
          <nav aria-label="Workspace settings sections" className="flex flex-wrap gap-2 lg:flex-col">
            <a className="border border-zinc-800 px-3 py-2 text-sm text-amber-300" href="#supabase">Supabase</a>
          </nav>
        </aside>
        <div className="space-y-6">
          <section id="supabase" className="scroll-mt-24 space-y-4" data-testid="workspace-settings-supabase">
            <div>
              <h2 className="font-display text-xl">Supabase</h2>
              <p className="text-sm text-zinc-400">
                {isDirectMode
                  ? "Workspace-scoped project access for direct mode. Persistent test branches and automatic production migrations stay unavailable."
                  : "Workspace-scoped project access and persistent test branch readiness."}
              </p>
            </div>
            <SupabaseReadinessSummary readiness={readiness} onRetry={retryRun} />
            {isDirectMode ? (
              <div className="border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
                Direct mode is active for this workspace. Review database changes manually before applying them to the linked database.
              </div>
            ) : null}
            {!connected ? (
              <div className="border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
                Supabase is not configured for this workspace. Paste the project ref and Management API token below.
              </div>
            ) : null}
            <div className="grid gap-3 border border-zinc-800 bg-zinc-900 p-4 md:grid-cols-2">
              <label className="block space-y-1 text-sm">
                <span className="text-zinc-300">Supabase project ref</span>
                <input aria-label="Supabase project ref" value={projectRef} onChange={(event) => setProjectRef(event.target.value)} className="w-full min-w-0 border border-zinc-800 bg-zinc-950 p-2 font-mono" />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-zinc-300">Supabase Management API token</span>
                <input aria-label="Supabase Management API token" type="password" value={token} onChange={(event) => setToken(event.target.value)} className="w-full min-w-0 border border-zinc-800 bg-zinc-950 p-2" />
              </label>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <button type="button" disabled={!projectRef.trim() || !token.trim()} onClick={() => void connect()} className="border border-emerald-500 px-3 py-1.5 text-sm text-emerald-300 disabled:opacity-45">Connect project</button>
                <button type="button" disabled={!token.trim()} onClick={() => void rotate()} className="border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 disabled:opacity-45">Rotate management token</button>
                <button type="button" onClick={() => void refreshReadiness()} className="border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200">Recheck readiness</button>
              </div>
            </div>
            {!isDirectMode ? (
              <fieldset className="space-y-3 border border-zinc-800 bg-zinc-900 p-4">
                <legend className="text-sm text-zinc-300">Persistent test branch</legend>
                <div className="flex flex-wrap gap-3 text-sm">
                  <label className="inline-flex items-center gap-2"><input type="radio" checked={branchMode === "create"} onChange={() => setBranchMode("create")} /> Create</label>
                  <label className="inline-flex items-center gap-2"><input type="radio" checked={branchMode === "attach"} onChange={() => setBranchMode("attach")} /> Attach existing</label>
                </div>
                <button type="button" disabled={!connected} onClick={() => void setupBranch()} className="border border-amber-500 px-3 py-1.5 text-sm text-amber-300 disabled:opacity-45">Create or attach persistent branch</button>
              </fieldset>
            ) : null}
            {connected ? (
              <div className="grid gap-3 border border-zinc-800 bg-zinc-900 p-4 md:grid-cols-2">
                <p className="text-sm"><span className="text-zinc-400">Project ref</span><br /><span className="font-mono">{readiness.workspace.projectRef}</span></p>
                <p className="text-sm"><span className="text-zinc-400">Database mode</span><br /><span className="font-mono">{dbMode ?? "branching"}</span></p>
                {!isDirectMode ? (
                  <p className="text-sm"><span className="text-zinc-400">Persistent branch</span><br /><span className="font-mono">{readiness.workspace.persistentTestBranchName ?? "not created"}</span></p>
                ) : null}
              </div>
            ) : null}
            {message ? <output className="block text-sm text-emerald-300">{message}</output> : null}
            {error ? <p role="alert" className="text-sm text-amber-300">{error}</p> : null}
          </section>
        </div>
      </div>
    </main>
  );
}
