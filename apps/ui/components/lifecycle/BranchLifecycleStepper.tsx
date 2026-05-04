"use client";

import { useState } from "react";
import { DestroyConfirmDialog } from "@/components/dialogs/DestroyConfirmDialog";
import type { LifecycleStepState } from "@/lib/lifecycleEvents";
import { emptyLifecycleSteps } from "@/lib/lifecycleEvents";

export type BranchLifecycleStepperProps = {
  steps?: LifecycleStepState[];
  branchRef?: string;
  branchName?: string;
  projectRef?: string;
  runId?: string;
  workspaceId?: string;
  workspaceRoot?: string;
  onRetryValidation?: () => Promise<void> | void;
  onDestroy?: () => Promise<void> | void;
};

const STATUS_LABELS: Record<LifecycleStepState["status"], string> = {
  idle: "idle",
  in_progress: "in progress",
  passed: "passed",
  failed: "failed",
  retained: "retained",
};

function supabaseBranchHref(projectRef?: string, branchRef?: string): string | null {
  if (!projectRef || !branchRef) return null;
  return `https://supabase.com/dashboard/project/${encodeURIComponent(projectRef)}/branches/${encodeURIComponent(branchRef)}`;
}

export function BranchLifecycleStepper({
  steps = emptyLifecycleSteps(),
  branchRef,
  branchName,
  projectRef,
  runId,
  workspaceId,
  workspaceRoot,
  onRetryValidation,
  onDestroy,
}: Readonly<BranchLifecycleStepperProps>) {
  const [confirmingDestroy, setConfirmingDestroy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const href = supabaseBranchHref(projectRef, branchRef);
  const hasProvisionedBranch = Boolean(branchRef && branchName);
  const retained = steps.some(step => step.status === "retained" || step.status === "failed");

  async function retryValidation() {
    if (onRetryValidation) {
      await onRetryValidation();
    } else if (branchRef) {
      await fetch(`/api/supabase/branches/${encodeURIComponent(branchRef)}/retry-validation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, workspaceId, projectRef, workspaceRoot }),
      });
    }
    setMessage("Validation retry requested.");
  }

  async function destroyBranch() {
    if (onDestroy) {
      await onDestroy();
    } else if (branchRef && branchName) {
      await fetch("/api/setup/supabase/destroy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, workspaceId, branchRef, branchName, confirmedName: branchName }),
      });
    }
    setConfirmingDestroy(false);
    setMessage("Destroy requested.");
  }

  return (
    <section className="space-y-3" data-testid="branch-lifecycle-stepper">
      <ol className="grid gap-2 md:grid-cols-5">
        {steps.map(step => (
          <li key={step.id} className="min-w-0 border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-zinc-100">{step.label}</span>
              <span className="border border-zinc-700 px-2 py-0.5 text-xs text-zinc-200" data-status={step.status}>{STATUS_LABELS[step.status]}</span>
            </div>
            {step.lastUpdateAt ? <time className="mt-2 block text-xs text-zinc-500" dateTime={step.lastUpdateAt}>{step.lastUpdateAt}</time> : null}
            {step.status !== "passed" && step.reason ? <p className="mt-2 text-xs text-amber-200">{step.reason}</p> : null}
          </li>
        ))}
      </ol>
      {hasProvisionedBranch ? (
        <div className="flex flex-wrap gap-2">
          {href ? <a className="border border-zinc-700 px-3 py-2 text-sm text-zinc-200" href={href}>Open in Supabase</a> : null}
          {retained ? <button type="button" className="border border-amber-700 px-3 py-2 text-sm text-amber-100" onClick={() => void retryValidation()}>Retry validation</button> : null}
          <button type="button" className="border border-red-700 px-3 py-2 text-sm text-red-200" onClick={() => setConfirmingDestroy(true)}>Destroy branch</button>
        </div>
      ) : null}
      {message ? <p className="text-sm text-emerald-200">{message}</p> : null}
      {confirmingDestroy && branchName ? (
        <DestroyConfirmDialog expectedName={branchName} actionLabel="Destroy branch" onCancel={() => setConfirmingDestroy(false)} onConfirm={() => void destroyBranch()} />
      ) : null}
    </section>
  );
}
