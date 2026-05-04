"use client";

import { useState } from "react";
import { StatusChip } from "@/components/StatusChip";
import { PlanLimitBanner } from "@/components/banners/PlanLimitBanner";
import { RetainedBranchBanner } from "@/components/banners/RetainedBranchBanner";
import { DestroyConfirmDialog } from "@/components/dialogs/DestroyConfirmDialog";
import type { AppConfigView } from "@/lib/setup/types";
import { CleanupPolicySelector } from "./CleanupPolicySelector";

type SupabaseView = AppConfigView["supabase"];

function messageFrom(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const candidate = body as { message?: unknown; error?: unknown };
  return typeof candidate.message === "string" ? candidate.message : typeof candidate.error === "string" ? candidate.error : fallback;
}

export function SupabaseSettingsSection({ supabase }: Readonly<{ supabase: SupabaseView }>) {
  const [state, setState] = useState(supabase);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmProtection, setConfirmProtection] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [recreateOpen, setRecreateOpen] = useState(false);

  async function saveSettings(next: Partial<SupabaseView> & { confirmed?: boolean }) {
    setError(null);
    const res = await fetch("/api/settings/supabase", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: state.workspaceId,
        cleanupPolicy: next.cleanupPolicy ?? state.cleanupPolicy,
        cleanupTtlHours: next.cleanupTtlHours ?? state.cleanupTtlHours,
        productionMigrationProtection: next.productionMigrationProtection ?? state.productionMigrationProtection,
        expectedVersion: state.settingsVersion,
        confirmed: next.confirmed,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.ok === false) {
      setError(messageFrom(body, "Supabase settings could not be saved."));
      return;
    }
    const saved = body.supabase as Partial<SupabaseView>;
    setState((prev) => ({ ...prev, ...saved }));
    setConfirmProtection(false);
  }

  async function rotate() {
    setError(null);
    setMessage(null);
    const res = await fetch("/api/settings/supabase/rotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, surface: "ui" }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.ok === false) {
      setError(`${messageFrom(body, "Supabase token rotation failed.")} Previous token remains active.`);
      return;
    }
    setToken("");
    setRotateOpen(false);
    setMessage("Supabase Management API token rotated.");
  }

  async function refreshPreflight() {
    setRefreshing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/setup/recheck", { method: "POST" });
      if (!res.ok) {
        setError(`Supabase preflight refresh failed: ${res.status}`);
        return;
      }
      setMessage("Supabase preflight refreshed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Supabase preflight refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }

  async function recreatePersistentBranch() {
    setError(null);
    setMessage(null);
    const branchName = state.persistentTestBranchName ?? "";
    const res = await fetch("/api/settings/supabase/recreate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: state.workspaceId, confirmedName: branchName }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.ok === false) {
      setError(messageFrom(body, "Supabase persistent test branch could not be recreated."));
      return;
    }
    setRecreateOpen(false);
    setState((prev) => ({ ...prev, persistentTestBranchStatus: "ACTIVE_HEALTHY" }));
    setMessage("Persistent test branch recreated.");
  }

  return (
    <section id="supabase" className="space-y-4" data-testid="settings-supabase">
      <div>
        <h2 className="font-display text-xl">Supabase</h2>
        <p className="text-sm text-zinc-400">Cloud Branching connection and branch database controls.</p>
      </div>
      <RetainedBranchBanner count={state.costRisk?.retainedBranchCount ?? 0} deepLinkHref="#supabase-diagnosis" />
      <PlanLimitBanner ratio={state.costRisk?.planLimitRatio ?? 0} />
      {state.projectRef ? (
        <div className="grid gap-3 border border-zinc-800 bg-zinc-900 p-4 md:grid-cols-2">
          <p className="text-sm"><span className="text-zinc-400">Project ref</span><br /><span className="font-mono">{state.projectRef}</span></p>
          <p className="text-sm"><span className="text-zinc-400">Region</span><br /><span>{state.region ?? "unknown"}</span></p>
          <p className="text-sm"><span className="text-zinc-400">Persistent test branch</span><br /><span className="font-mono">{state.persistentTestBranchName ?? "not created"}</span></p>
          <div className="text-sm"><span className="text-zinc-400">Branch status</span><br /><StatusChip state={state.persistentTestBranchStatus ?? "not-configured"} /></div>
          <p className="text-sm"><span className="text-zinc-400">Last checked</span><br />{state.lastCheckedAt ? new Date(state.lastCheckedAt).toLocaleString() : "Never"}</p>
          <p className="text-sm"><span className="text-zinc-400">Token</span><br />{state.tokenPresent ? "Present" : "Missing"}</p>
        </div>
      ) : (
        <p className="border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">Supabase is not connected for this workspace.</p>
      )}
      <CleanupPolicySelector
        policy={state.cleanupPolicy}
        ttlHours={state.cleanupTtlHours}
        onChange={(next) => {
          if (next.valid) void saveSettings(next);
        }}
      />
      <div className="space-y-2 border border-zinc-800 bg-zinc-900 p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.productionMigrationProtection === "on"}
            onChange={(event) => {
              if (event.target.checked) setConfirmProtection(true);
              else void saveSettings({ productionMigrationProtection: "off" });
            }}
          />
          <span>Production migration protection</span>
        </label>
        {confirmProtection ? (
          <div className="space-y-2 border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
            <p>Merge will apply migrations to production/main automatically when other guards pass.</p>
            <button type="button" onClick={() => void saveSettings({ productionMigrationProtection: "on", confirmed: true })} className="border border-amber-500 px-2 py-1 text-xs text-amber-200">Confirm enable</button>
            <button type="button" onClick={() => setConfirmProtection(false)} className="ml-2 border border-zinc-700 px-2 py-1 text-xs text-zinc-200">Cancel</button>
          </div>
        ) : null}
      </div>
      <button type="button" onClick={() => setRotateOpen((open) => !open)} className="border border-zinc-700 px-2 py-1 text-xs text-zinc-200">Rotate Management API token</button>
      {rotateOpen ? (
        <div className="space-y-2 border border-zinc-800 bg-zinc-900 p-4">
          <label className="block space-y-1 text-sm">
            <span className="text-zinc-300">supabase.management_token</span>
            <input type="password" value={token} onChange={(event) => setToken(event.target.value)} className="w-full border border-zinc-800 bg-zinc-950 p-2" />
          </label>
          <button type="button" disabled={!token.trim()} onClick={() => void rotate()} className="border border-amber-500 px-2 py-1 text-xs text-amber-300 disabled:opacity-45">Save rotated token</button>
        </div>
      ) : null}
      <button type="button" disabled={refreshing} aria-busy={refreshing} onClick={() => void refreshPreflight()} className="border border-zinc-700 px-2 py-1 text-xs text-zinc-200 disabled:opacity-45">
        {refreshing ? "Refreshing" : "Refresh preflight"}
      </button>
      {state.persistentTestBranchName ? (
        <button type="button" onClick={() => setRecreateOpen(true)} className="ml-2 border border-red-700 px-2 py-1 text-xs text-red-200">Recreate persistent test branch</button>
      ) : null}
      {recreateOpen && state.persistentTestBranchName ? (
        <DestroyConfirmDialog
          expectedName={state.persistentTestBranchName}
          actionLabel="Recreate persistent test branch"
          onCancel={() => setRecreateOpen(false)}
          onConfirm={() => void recreatePersistentBranch()}
        />
      ) : null}
      {message ? <output className="block text-sm text-emerald-300">{message}</output> : null}
      {error ? <p role="alert" className="text-sm text-amber-300">{error}</p> : null}
    </section>
  );
}
