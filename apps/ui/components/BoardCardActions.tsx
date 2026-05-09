"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { BoardCardDTO } from "../lib/types";
import type { WorkflowGitBlockedActionResult } from "@/lib/engine/types";
import { WorkflowGitRepairPanel } from "@/components/WorkflowGitRepairPanel";
import {
  type VisibleActionFallbackSurface,
  type VisibleActionId,
  recordVisibleActionFallback,
} from "@/lib/visibleActionFacts";

type ActionDef = { action: string; label: string };
const ACTION_ERROR_FALLBACK = "Action could not be completed.";
const ACTIONS_BY_ID: Record<VisibleActionId, ActionDef> = {
  import_prepared: { action: "import_prepared", label: "Import prepared" },
  start_visual_companion: { action: "start_visual_companion", label: "Start visual companion" },
  start_frontend_design: { action: "start_frontend_design", label: "Start frontend design" },
  promote_to_requirements: { action: "promote_to_requirements", label: "Promote to requirements" },
  cancel_promotion: { action: "cancel_promotion", label: "Cancel" },
  promote_to_base: { action: "promote_to_base", label: "Promote to base" },
};

function isSettledPhase(phase: string): boolean {
  return phase === "completed" || phase === "review_required";
}

function isImportPreparedColumn(column: BoardCardDTO["column"]): boolean {
  return column === "idea" || column === "requirements";
}

function legacyVisibleActionIdsForStage(stage: BoardCardDTO["current_stage"] | null): VisibleActionId[] {
  if (stage === "visual-companion") return ["start_frontend_design"];
  if (stage === "frontend-design" || stage == null) return ["promote_to_requirements"];
  return [];
}

function legacyVisibleActionIdsForMerge(card: BoardCardDTO): VisibleActionId[] {
  const actions: VisibleActionId[] = [];
  if (card.hasReviewGateWaiting) actions.push("cancel_promotion");
  if (card.hasReviewGateWaiting || card.hasBlockedRun || card.hasOpenPrompt) actions.push("promote_to_base");
  return actions;
}

function legacyVisibleActionIdsForCard(card: BoardCardDTO): VisibleActionId[] {
  const phase = card.phase_status ?? "";
  const stage = card.current_stage ?? null;

  if (isImportPreparedColumn(card.column) && phase !== "running") return ["import_prepared"];
  if (card.column === "brainstorm" && isSettledPhase(phase)) return ["start_visual_companion", "import_prepared"];
  if (card.column === "frontend" && isSettledPhase(phase)) return legacyVisibleActionIdsForStage(stage);
  if (card.column === "merge") return legacyVisibleActionIdsForMerge(card);
  return [];
}

interface BoardCardActionsProps {
  card: BoardCardDTO;
  surface?: VisibleActionFallbackSurface;
}

function actionDefsFor(actionIds: readonly VisibleActionId[]): ActionDef[] {
  return actionIds.map((action) => ACTIONS_BY_ID[action]);
}

export function actionsFor(card: BoardCardDTO): ActionDef[] {
  const actionIds = card.visibleActions ?? legacyVisibleActionIdsForCard(card);
  return actionDefsFor(actionIds);
}

function parseActionError(body: unknown): string {
  const candidate = body as { message?: unknown; error?: unknown };
  const message = typeof candidate.message === "string" ? candidate.message.trim() : "";
  if (message) return message;

  const error = typeof candidate.error === "string" ? candidate.error.trim() : "";
  if (error && /[^a-z0-9_]/i.test(error)) return error;

  return ACTION_ERROR_FALLBACK;
}

function parseWorkflowGitBlocker(body: unknown, status: number): WorkflowGitBlockedActionResult | null {
  const candidate = body as Partial<WorkflowGitBlockedActionResult>;
  if (candidate.code !== "workflow_git_blocked" || !candidate.intent || typeof candidate.message !== "string") return null;
  return { ...candidate, ok: false, status } as WorkflowGitBlockedActionResult;
}

export function BoardCardActions({ card, surface = "board" }: Readonly<BoardCardActionsProps>) {
  const actions = actionsFor(card);
  const [error, setError] = useState<string | null>(null);
  const [gitBlocker, setGitBlocker] = useState<WorkflowGitBlockedActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const lastRecordedFallbackKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const itemId = card.id || card.itemCode || "";
    const fallbackKey = `${surface}:${itemId}`;
    if (card.visibleActions !== undefined) {
      lastRecordedFallbackKeyRef.current = null;
      return;
    }
    if (lastRecordedFallbackKeyRef.current === fallbackKey) return;
    recordVisibleActionFallback({ itemId, surface });
    lastRecordedFallbackKeyRef.current = fallbackKey;
  }, [card.id, card.itemCode, card.visibleActions, surface]);

  if (actions.length === 0) return null;

  const itemId = card.id || card.itemCode || "";

  async function runAction(action: string): Promise<void> {
    try {
      const body: Record<string, string> = {};
      if (action === "import_prepared") {
        const path = globalThis.prompt("Prepared artifact directory");
        if (!path?.trim()) return;
        body.path = path.trim();
      }
      const res = await fetch(
        `/api/items/${encodeURIComponent(itemId)}/actions/${encodeURIComponent(action)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      if (res.ok) {
        setError(null);
        setGitBlocker(null);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        const blocker = parseWorkflowGitBlocker(body, res.status);
        if (blocker) {
          setGitBlocker(blocker);
          setError(null);
          return;
        }
        setError(parseActionError(body));
      }
      // No client-side optimistic state; the SSE workspace stream will
      // emit `item_column_changed` and the live overlay re-buckets the
      // card without a refresh.
    } catch (err) {
      setError(err instanceof Error ? err.message : "network_error");
    }
  }

  const onClick = (action: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    setGitBlocker(null);
    startTransition(() => {
      void runAction(action);
    });
  };

  return (
    <div data-testid="board-card-actions" className="mt-2 flex flex-col gap-1 relative z-10">
      <div className="flex gap-1 flex-wrap">
        {actions.map((a) => (
          <button
            key={a.action}
            type="button"
            data-testid={`board-card-action-${a.action}`}
            disabled={isPending}
            onClick={onClick(a.action)}
            className="px-2 py-0.5 text-[11px] uppercase tracking-wider border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {a.label}
          </button>
        ))}
      </div>
      {error ? (
        <div
          role="alert"
          data-testid="board-card-action-error"
          className="text-[10px]"
          style={{ color: "var(--color-coral)" }}
        >
          {error}
        </div>
      ) : null}
      {gitBlocker ? (
        <WorkflowGitRepairPanel
          blocker={gitBlocker}
          itemTitle={card.title}
          itemCode={card.itemCode}
          onContinue={(action) => runAction(action)}
        />
      ) : null}
    </div>
  );
}
