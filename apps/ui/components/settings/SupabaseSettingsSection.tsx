"use client";

import { useState } from "react";
import { StatusChip } from "@/components/StatusChip";
import { PlanLimitBanner } from "@/components/banners/PlanLimitBanner";
import { RetainedBranchBanner } from "@/components/banners/RetainedBranchBanner";
import { DestroyConfirmDialog } from "@/components/dialogs/DestroyConfirmDialog";
import type { AppConfigView } from "@/lib/setup/types";
import { CleanupPolicySelector } from "./CleanupPolicySelector";

type SupabaseView = AppConfigView["supabase"];

function SupabaseConnectionFacts({
  supabase,
  showsBranchControls,
}: Readonly<{
  supabase: SupabaseView;
  showsBranchControls: boolean;
}>) {
  return (
    <div className="grid gap-3 border border-[var(--color-zinc-800)] bg-[var(--color-zinc-900)] p-4 md:grid-cols-2">
      <p className="text-sm"><span className="text-[var(--color-zinc-400)]">Project ref</span><br /><span className="font-mono">{supabase.projectRef}</span></p>
      <p className="text-sm"><span className="text-[var(--color-zinc-400)]">Region</span><br /><span>{supabase.region ?? "unknown"}</span></p>
      <p className="text-sm"><span className="text-[var(--color-zinc-400)]">Database mode</span><br /><span className="font-mono">{supabase.dbMode ?? "branching"}</span></p>
      {showsBranchControls ? (
        <p className="text-sm"><span className="text-[var(--color-zinc-400)]">Persistent test branch</span><br /><span className="font-mono">{supabase.persistentTestBranchName ?? "not created"}</span></p>
      ) : null}
      {showsBranchControls ? (
        <div className="text-sm"><span className="text-[var(--color-zinc-400)]">Branch status</span><br /><StatusChip state={supabase.persistentTestBranchStatus ?? "not-configured"} /></div>
      ) : null}
      <p className="text-sm"><span className="text-[var(--color-zinc-400)]">Last checked</span><br />{supabase.lastCheckedAt ? new Date(supabase.lastCheckedAt).toLocaleString() : "Never"}</p>
      <p className="text-sm"><span className="text-[var(--color-zinc-400)]">Token</span><br />{supabase.tokenPresent ? "Present" : "Missing"}</p>
    </div>
  );
}

function ProductionMigrationProtectionPanel({
  enabled,
  confirmOpen,
  onToggle,
  onConfirm,
  onCancel,
}: Readonly<{
  enabled: boolean;
  confirmOpen: boolean;
  onToggle: (checked: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  return (
    <div className="space-y-2 border border-[var(--color-zinc-800)] bg-[var(--color-zinc-900)] p-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
        <span>Production migration protection</span>
      </label>
      {confirmOpen ? (
        <div className="space-y-2 border border-[var(--color-amber-700)] bg-[var(--color-zinc-900)] p-3 text-sm text-[var(--color-zinc-100)]">
          <p>Merge will apply migrations to production/main automatically when other guards pass.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onConfirm} className="border border-[var(--color-amber-500)] px-2 py-1 text-xs text-[var(--color-amber-200)]">Confirm enable</button>
            <button type="button" onClick={onCancel} className="border border-[var(--color-zinc-700)] px-2 py-1 text-xs text-[var(--color-zinc-200)]">Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
  const isDirectMode = state.dbMode === "direct";
  const showsBranchControls = isDirectMode === false;

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
    <section id="supabase" className="scroll-mt-24 space-y-4" data-testid="settings-supabase">
      <div>
        <h2 className="font-display text-xl">Supabase</h2>
        <p className="text-sm text-[var(--color-zinc-400)]">
          {isDirectMode
            ? "Direct mode connection details and manual database review guidance."
            : "Branching connection details and branch database controls."}
        </p>
      </div>
      {state.projectRef ? (
        <>
          {showsBranchControls ? <RetainedBranchBanner count={state.costRisk?.retainedBranchCount ?? 0} deepLinkHref="#supabase-diagnosis" /> : null}
          {showsBranchControls ? <PlanLimitBanner ratio={state.costRisk?.planLimitRatio ?? 0} /> : null}
          {isDirectMode ? (
            <div className="border border-[var(--color-zinc-800)] bg-[var(--color-zinc-900)] p-4 text-sm text-[var(--color-zinc-300)]">
              Direct mode is active. Persistent test branches stay unavailable, and automatic production migrations remain skipped.
            </div>
          ) : null}
          <SupabaseConnectionFacts supabase={state} showsBranchControls={showsBranchControls} />
          {showsBranchControls ? (
            <CleanupPolicySelector
              policy={state.cleanupPolicy}
              ttlHours={state.cleanupTtlHours}
              onChange={(next) => {
                if (next.valid) void saveSettings(next);
              }}
            />
          ) : null}
          {showsBranchControls ? (
            <ProductionMigrationProtectionPanel
              enabled={state.productionMigrationProtection === "on"}
              confirmOpen={confirmProtection}
              onToggle={(checked) => {
                if (checked) setConfirmProtection(true);
                else void saveSettings({ productionMigrationProtection: "off" });
              }}
              onConfirm={() => void saveSettings({ productionMigrationProtection: "on", confirmed: true })}
              onCancel={() => setConfirmProtection(false)}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setRotateOpen((open) => !open)} className="border border-[var(--color-zinc-700)] px-2 py-1 text-xs text-[var(--color-zinc-200)]">Rotate Management API token</button>
            <button type="button" disabled={refreshing} aria-busy={refreshing} onClick={() => void refreshPreflight()} className="border border-[var(--color-zinc-700)] px-2 py-1 text-xs text-[var(--color-zinc-200)] disabled:opacity-45">
              {refreshing ? "Refreshing" : "Refresh preflight"}
            </button>
            {!isDirectMode && state.persistentTestBranchName ? (
              <button type="button" onClick={() => setRecreateOpen(true)} className="border border-[var(--color-coral)] px-2 py-1 text-xs text-[var(--color-coral)]">Recreate persistent test branch</button>
            ) : null}
          </div>
          {rotateOpen ? (
            <div className="space-y-2 border border-[var(--color-zinc-800)] bg-[var(--color-zinc-900)] p-4">
              <label className="block space-y-1 text-sm">
                <span className="text-[var(--color-zinc-300)]">supabase.management_token</span>
                <input type="password" value={token} onChange={(event) => setToken(event.target.value)} className="w-full border border-[var(--color-zinc-800)] bg-[var(--color-zinc-950)] p-2" />
              </label>
              <button type="button" disabled={!token.trim()} onClick={() => void rotate()} className="border border-[var(--color-amber-500)] px-2 py-1 text-xs text-[var(--color-amber-300)] disabled:opacity-45">Save rotated token</button>
            </div>
          ) : null}
          {recreateOpen && state.persistentTestBranchName ? (
            <DestroyConfirmDialog
              expectedName={state.persistentTestBranchName}
              actionLabel="Recreate persistent test branch"
              onCancel={() => setRecreateOpen(false)}
              onConfirm={() => void recreatePersistentBranch()}
            />
          ) : null}
        </>
      ) : (
        <div className="space-y-3">
          <p className="border border-[var(--color-zinc-800)] bg-[var(--color-zinc-900)] p-4 text-sm text-[var(--color-zinc-300)]">Supabase is not connected for this workspace.</p>
          <a
            href="/setup#supabase"
            className="inline-block border border-[var(--color-amber-500)] px-3 py-1.5 text-xs text-[var(--color-amber-300)] hover:bg-[var(--color-zinc-900)]"
          >
            Connect Supabase
          </a>
        </div>
      )}
      {message ? <output className="block text-sm text-[var(--color-emerald-300)]">{message}</output> : null}
      {error ? <p role="alert" className="text-sm text-[var(--color-amber-300)]">{error}</p> : null}
    </section>
  );
}
