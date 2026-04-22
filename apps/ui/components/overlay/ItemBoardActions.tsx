"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { performItemAction, type ItemAction, type ItemActionResponse } from "@/lib/api";
import { MonoLabel } from "@/components/primitives/MonoLabel";

type Column = NonNullable<Parameters<typeof validActionsFor>[0]>;
type Phase = NonNullable<Parameters<typeof validActionsFor>[1]>;

type ActionDescriptor = {
  action: ItemAction;
  label: string;
  kind: "start-run" | "state";
};

function validActionsFor(
  column: "idea" | "brainstorm" | "requirements" | "implementation" | "done" | undefined,
  phase: "draft" | "running" | "review_required" | "completed" | "failed" | undefined
): ActionDescriptor[] {
  if (!column || !phase) return [];
  const actions: ActionDescriptor[] = [];
  if (column === "idea" && phase === "draft") {
    actions.push({ action: "start_brainstorm", label: "Start brainstorm", kind: "start-run" });
  }
  if (column === "brainstorm") {
    actions.push({ action: "promote_to_requirements", label: "Promote to requirements", kind: "state" });
    actions.push({ action: "resume_run", label: "Resume run", kind: "state" });
  }
  if (column === "requirements") {
    actions.push({ action: "start_implementation", label: "Start implementation", kind: "start-run" });
    actions.push({ action: "resume_run", label: "Resume run", kind: "state" });
  }
  if (column === "implementation" && (phase === "running" || phase === "failed")) {
    actions.push({ action: "resume_run", label: "Resume run", kind: "state" });
  }
  if (column === "implementation" && phase === "review_required") {
    actions.push({ action: "mark_done", label: "Mark done", kind: "state" });
  }
  return actions;
}

type Props = {
  itemId: string;
  column: Column;
  phase: Phase;
};

export function ItemBoardActions({ itemId, column, phase }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<ItemAction | null>(null);
  const [toast, setToast] = useState<{ kind: "error" | "info"; msg: string } | null>(null);

  const actions = validActionsFor(column, phase);
  if (actions.length === 0) return null;

  const onClick = async (descriptor: ActionDescriptor) => {
    setToast(null);
    setBusy(descriptor.action);
    let response: ItemActionResponse;
    try {
      response = await performItemAction(itemId, descriptor.action);
    } catch (err) {
      setBusy(null);
      setToast({ kind: "error", msg: err instanceof Error ? err.message : "Network error" });
      return;
    }

    if (!response.ok) {
      setBusy(null);
      if (response.status === 409 && response.current) {
        setToast({
          kind: "error",
          msg: `Cannot ${descriptor.action} from ${response.current.column}/${response.current.phaseStatus}`
        });
      } else if (response.status === 422 && descriptor.action === "resume_run") {
        setToast({ kind: "error", msg: "Open the run detail page and provide remediation details to resume." });
      } else {
        setToast({ kind: "error", msg: response.error });
      }
      return
    }

    if (response.runId && descriptor.kind === "start-run") {
      router.push(`/runs/${response.runId}`);
      return;
    }

    // Optimistic: force a router refresh so the server component re-renders
    // the board with the updated persisted state. Phase 4 will layer live SSE
    // on top of this so refresh is not needed for remote changes.
    setBusy(null);
    setToast({ kind: "info", msg: `Action ${descriptor.action} applied.` });
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <div className="detail-block">
      <MonoLabel>Board actions</MonoLabel>
      <h3>Workflow controls</h3>
      <div className="detail-actions">
        {actions.map(descriptor => (
          <button
            key={descriptor.action}
            type="button"
            className={descriptor.kind === "start-run" ? "detail-action primary" : "detail-action"}
            disabled={busy !== null || pending}
            onClick={() => onClick(descriptor)}
            data-item-action={descriptor.action}
          >
            {busy === descriptor.action ? "…" : descriptor.label}
          </button>
        ))}
      </div>
      {toast ? (
        <p role="status" className={`board-action-toast ${toast.kind}`} aria-live="polite">
          {toast.msg}
        </p>
      ) : null}
    </div>
  );
}
