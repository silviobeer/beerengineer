"use client";

import { useState } from "react";
import { StatusChip } from "@/components/StatusChip";
import type { SupabaseReadinessSnapshot } from "@/lib/setup/types";

function fallbackFor(status: SupabaseReadinessSnapshot["status"]): string {
  if (status === "ready") return "Supabase readiness is complete.";
  if (status === "checking") return "Supabase readiness is still checking.";
  if (status === "error") return "Supabase readiness could not be checked.";
  return "Supabase setup is required before DB-relevant execution can start.";
}

export function SupabaseReadinessSummary({
  readiness,
  onRetry,
}: Readonly<{
  readiness: SupabaseReadinessSnapshot;
  onRetry?: () => Promise<SupabaseReadinessSnapshot | void> | SupabaseReadinessSnapshot | void;
}>) {
  const [state, setState] = useState(readiness);
  const [busy, setBusy] = useState(false);
  const retryVisible = state.status === "ready" && state.retry.available && Boolean(state.retry.runId);

  async function retry() {
    if (!onRetry) return;
    setBusy(true);
    try {
      const next = await onRetry();
      if (next) setState(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 border border-zinc-800 bg-zinc-900 p-4" data-testid="supabase-readiness-summary">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-display text-lg text-zinc-100">Supabase readiness</h3>
        <StatusChip state={state.status} />
        {state.workspace.key ? <span className="font-mono text-xs text-zinc-400">workspace {state.workspace.key}</span> : null}
      </div>
      {state.message ? <p className="text-sm text-amber-200">{state.message}</p> : null}
      <p className="text-sm text-zinc-300">{fallbackFor(state.status)}</p>
      {state.branch ? (
        <p className="text-sm text-zinc-400">
          Branch: <span className="font-mono">{state.branch.ref ?? "not configured"}</span>{" "}
          <span className="text-zinc-500">({state.branch.providerStatus ?? state.branch.status})</span>
        </p>
      ) : null}
      {state.missingSetupActions.length > 0 ? (
        <div>
          <p className="text-xs uppercase text-zinc-500">Missing setup actions</p>
          <ul className="mt-2 space-y-1 text-sm text-zinc-200">
            {state.missingSetupActions.map((action) => <li key={action}>- {action}</li>)}
          </ul>
        </div>
      ) : null}
      {state.retry.available && state.retry.runId ? (
        <div className="space-y-2 border border-zinc-800 bg-zinc-950 p-3">
          <p className="text-sm text-zinc-300">Retry run is separate from setup actions.</p>
          {retryVisible ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void retry()}
              className="border border-emerald-500 px-3 py-1.5 text-sm text-emerald-300 disabled:opacity-45"
            >
              {busy ? "Retrying" : "Retry blocked run"}
            </button>
          ) : (
            <button type="button" disabled className="border border-zinc-700 px-3 py-1.5 text-sm text-zinc-500">
              Retry blocked run
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
