"use client";

import { useMemo, useState } from "react";
import type { WorkspaceGitReadiness, WorkspaceGitRepairResponse } from "@/lib/setup/types";
import type { ItemAction, WorkflowGitBlockedActionResult } from "@/lib/engine/types";
import { GitIdentityForm } from "@/components/setup/GitIdentityForm";
import { StatusChip } from "@/components/StatusChip";

interface WorkflowGitRepairPanelProps {
  readonly blocker: WorkflowGitBlockedActionResult;
  readonly itemTitle?: string;
  readonly itemCode?: string;
  readonly onContinue: (action: ItemAction) => Promise<void> | void;
}

function readinessMessage(readiness: WorkspaceGitReadiness | undefined, fallback: string): string {
  return readiness?.blocker?.message ?? fallback;
}

async function parseJson<T>(response: Response): Promise<T | null> {
  return response.json().catch(() => null) as Promise<T | null>;
}

function modeButtonClass(active: boolean): string {
  return active
    ? "border border-amber-400 bg-amber-500 px-2 py-1 text-zinc-950"
    : "border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200";
}

function repairUnavailableMessage(error: WorkflowGitBlockedActionResult["error"]): string {
  if (error === "git_not_installed") return "Install Git, then recheck setup before starting this workflow.";
  return "Reconnect this workspace to a valid Git repository before starting this workflow.";
}

function RepairModeToggle({
  mode,
  onMode,
}: Readonly<{ mode: "default" | "custom"; onMode: (mode: "default" | "custom") => void }>) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <button
        type="button"
        aria-pressed={mode === "default"}
        onClick={() => onMode("default")}
        className={modeButtonClass(mode === "default")}
      >
        Use saved app identity
      </button>
      <button
        type="button"
        aria-pressed={mode === "custom"}
        onClick={() => onMode("custom")}
        className={modeButtonClass(mode === "custom")}
      >
        Enter another identity
      </button>
    </div>
  );
}

function WorkflowRepairUnavailable({ error }: Readonly<{ error: WorkflowGitBlockedActionResult["error"] }>) {
  return (
    <div className="border border-zinc-800 bg-zinc-950/40 p-3 text-zinc-400">
      {repairUnavailableMessage(error)}
    </div>
  );
}

export function WorkflowGitRepairPanel({
  blocker,
  itemTitle,
  itemCode,
  onContinue,
}: Readonly<WorkflowGitRepairPanelProps>) {
  const [readiness, setReadiness] = useState<WorkspaceGitReadiness | undefined>(blocker.readiness);
  const [mode, setMode] = useState<"default" | "custom">(blocker.readiness?.appDefaultIdentity ? "default" : "custom");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [readyToContinue, setReadyToContinue] = useState(false);

  const appDefault = readiness?.appDefaultIdentity;
  const initialIdentity = mode === "default" && appDefault ? appDefault : undefined;
  const workspaceId = blocker.repair?.workspaceId ?? readiness?.workspace.id;
  const workspaceKey = blocker.repair?.workspaceKey ?? readiness?.workspace.key;
  const canRepair = blocker.error === "git_identity_missing" && Boolean(workspaceId) && readiness?.git.installed !== false;
  const canContinue = readyToContinue && readiness?.ready === true;

  const status = useMemo(() => {
    if (blocker.error === "git_not_installed") return "missing";
    if (canContinue) return "ok";
    return "blocked";
  }, [blocker.error, canContinue]);

  async function recheckReadiness(manageBusy = true): Promise<WorkspaceGitReadiness | undefined> {
    if (manageBusy && busy) return readiness;
    if (!workspaceId) return readiness;
    if (manageBusy) {
      setBusy(true);
      setAlert(null);
    }
    try {
      const params = new URLSearchParams({ workspaceId });
      const response = await fetch(`/api/setup/git-readiness?${params.toString()}`, { cache: "no-store" });
      const body = await parseJson<WorkspaceGitReadiness>(response);
      if (body?.mode === "workspace") {
        setReadiness(body);
        return body;
      }
      return readiness;
    } catch (error) {
      if (manageBusy) setAlert(error instanceof Error ? error.message : "Git readiness recheck failed.");
      return readiness;
    } finally {
      if (manageBusy) setBusy(false);
    }
  }

  async function repair(identity: { displayName: string; email: string }): Promise<void> {
    if (!workspaceId || !confirmed || busy) return;
    setBusy(true);
    setAlert(null);
    setReadyToContinue(false);
    try {
      const response = await fetch("/api/setup/git-identity/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          workspaceKey,
          identity,
        }),
      });
      const body = await parseJson<WorkspaceGitRepairResponse>(response);
      if (body?.readiness) setReadiness(body.readiness);
      const fresh = await recheckReadiness(false);
      if (response.ok && body?.ok && fresh?.ready) {
        setReadyToContinue(true);
        setAlert("Git identity is ready for this workspace.");
        return;
      }
      setAlert(fresh?.workflowBlocked
        ? readinessMessage(fresh, "Git identity is still blocking this workflow start.")
        : body?.message ?? "Git identity is still blocking this workflow start.");
    } catch (error) {
      setAlert(error instanceof Error ? error.message : "Git repair failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="workflow-git-repair-panel"
      className="space-y-4 border border-amber-500/50 bg-zinc-950 p-4 text-sm text-zinc-200"
      aria-label="Workflow Git repair"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <StatusChip state={status} />
            <span className="text-xs uppercase text-amber-200">Git readiness</span>
          </div>
          <h3 className="font-display text-lg text-zinc-100">Start is waiting for Git identity</h3>
          <p className="text-zinc-400">{readinessMessage(readiness, blocker.message)}</p>
        </div>
        <div className="min-w-0 text-right text-xs text-zinc-400">
          {itemCode ? <div className="font-mono">{itemCode}</div> : null}
          {itemTitle ? <div className="max-w-64 truncate text-zinc-200">{itemTitle}</div> : null}
          <div className="font-mono">{blocker.intent.action}</div>
        </div>
      </div>

      {canRepair ? (
        <div className="space-y-3">
          {appDefault ? <RepairModeToggle mode={mode} onMode={setMode} /> : null}
          <label className="flex items-start gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5"
            />
            <span>Write this identity to the registered workspace as repo-local Git config.</span>
          </label>
          <GitIdentityForm
            title={mode === "default" ? "Apply saved identity" : "Workspace identity"}
            description="This writes only to the current repository. It does not change global Git config."
            submitLabel="Repair workspace"
            initialIdentity={initialIdentity}
            busy={busy}
            disabled={!confirmed}
            onSubmit={repair}
          />
        </div>
      ) : (
        <WorkflowRepairUnavailable error={blocker.error} />
      )}

      {alert ? (
        <p role="alert" className={canContinue ? "text-emerald-300" : "text-amber-200"}>
          {alert}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void recheckReadiness()}
          disabled={busy}
          className="border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 disabled:opacity-50"
        >
          Recheck
        </button>
        <button
          type="button"
          disabled={!canContinue || busy}
          onClick={() => void onContinue(blocker.intent.action)}
          className="border border-amber-500 bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
        >
          Continue start
        </button>
      </div>
    </section>
  );
}
