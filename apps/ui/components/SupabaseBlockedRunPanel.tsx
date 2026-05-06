"use client";

import { useState } from "react";
import type { BoardCardDTO } from "@/lib/types";

type SupabaseBlocker = NonNullable<BoardCardDTO["supabaseBlocker"]>;

function fallbackMessage(blocker: SupabaseBlocker): string {
  return blocker.message ?? "DB-relevant planned waves require Supabase readiness before execution workers start.";
}

export function SupabaseBlockedRunPanel({
  blocker,
  compact = false,
}: Readonly<{
  blocker?: SupabaseBlocker;
  compact?: boolean;
}>) {
  const [current, setCurrent] = useState(blocker);
  const [hidden, setHidden] = useState(false);
  const [retrying, setRetrying] = useState(false);
  if (hidden || !current) return null;

  const blockerState = current;
  const workspaceKey = blockerState.workspace.key;
  const canRetry = blockerState.retry.available && blockerState.retry.ready;
  const settingsHref = workspaceKey ? `/w/${encodeURIComponent(workspaceKey)}/settings#supabase` : null;

  async function retryRun() {
    if (!canRetry) return;
    setRetrying(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(blockerState.runId)}/supabase-readiness/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary: "Supabase readiness setup updated." }),
      });
      const body = await res.json().catch(() => null) as { recoveryStatus?: string | null; readiness?: SupabaseBlocker } | null;
      if (res.ok && body?.recoveryStatus !== "blocked") {
        setHidden(true);
        return;
      }
      if (body?.readiness) setCurrent(body.readiness);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <section
      data-testid="supabase-blocked-run-panel"
      className={`mt-3 border border-amber-700 bg-amber-950/20 p-3 text-sm text-amber-100 ${compact ? "space-y-2" : "space-y-3"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid="supabase-blocked-chip"
          className="inline-flex items-center gap-1 border border-amber-600 bg-zinc-950 px-2 py-0.5 text-xs font-medium text-amber-200"
        >
          <span aria-hidden="true" className="font-mono text-[10px]">DB</span>
          Supabase blocked
        </span>
        {workspaceKey ? <span className="font-mono text-xs text-amber-200">workspace {workspaceKey}</span> : null}
      </div>
      <p className="text-xs text-amber-100/90">{fallbackMessage(blockerState)}</p>
      {blockerState.missingSetupActions.length > 0 ? (
        <div>
          <p className="text-[11px] uppercase text-amber-200/70">Missing setup actions</p>
          <ul className="mt-1 space-y-1 break-words">
            {blockerState.missingSetupActions.map(action => <li key={action}>- {action}</li>)}
          </ul>
        </div>
      ) : null}
      {settingsHref ? (
        <a className="inline-flex border border-amber-500 px-2 py-1 text-xs text-amber-100" href={settingsHref}>
          Open workspace Supabase settings
        </a>
      ) : (
        <p role="alert" className="text-xs text-amber-200">Workspace settings link unavailable: workspace key is missing.</p>
      )}
      {blockerState.retry.available ? (
        <button
          type="button"
          disabled={!canRetry || retrying}
          onClick={() => void retryRun()}
          className="ml-2 inline-flex border border-zinc-700 px-2 py-1 text-xs text-zinc-200 disabled:opacity-45"
        >
          Retry blocked run
        </button>
      ) : null}
    </section>
  );
}
