"use client";

import { useState, useTransition } from "react";
import type { BoardCardDTO } from "../lib/types";

type ActionDef = { action: string; label: string };

/**
 * Decide which manual-progression buttons to surface for a card based on its
 * column / phase / current_stage. Mirrors the engine's MATRIX in
 * apps/engine/src/core/itemActions.ts — UI-side prediction so we don't render
 * dead buttons. The engine remains authoritative; if the prediction is wrong
 * the click will get a 409 and we surface it.
 */
function actionsFor(card: BoardCardDTO): ActionDef[] {
  const phase = card.phase_status ?? "";
  const stage = card.current_stage ?? null;

  if ((card.column === "idea" || card.column === "requirements") && phase !== "running") {
    return [{ action: "import_prepared", label: "Import prepared" }];
  }
  if (card.column === "brainstorm" && (phase === "completed" || phase === "review_required")) {
    return [
      { action: "start_visual_companion", label: "Start visual companion" },
      { action: "import_prepared", label: "Import prepared" },
    ];
  }
  if (card.column === "frontend" && (phase === "review_required" || phase === "completed")) {
    if (stage === "visual-companion") {
      return [{ action: "start_frontend_design", label: "Start frontend design" }];
    }
    if (stage === "frontend-design" || stage == null) {
      return [{ action: "promote_to_requirements", label: "Promote to requirements" }];
    }
  }
  if (card.column === "merge") {
    const actions: ActionDef[] = [];
    if (card.hasReviewGateWaiting) {
      actions.push({ action: "cancel_promotion", label: "Cancel" });
    }
    if (card.hasReviewGateWaiting || card.hasBlockedRun || card.hasOpenPrompt) {
      actions.push({ action: "promote_to_base", label: "Promote to base" });
    }
    return actions;
  }
  return [];
}

interface BoardCardActionsProps {
  card: BoardCardDTO;
}

function parseActionError(body: unknown, status: number): string {
  return (body as { error?: string }).error ?? `engine_${status}`;
}

export function BoardCardActions({ card }: Readonly<BoardCardActionsProps>) {
  const actions = actionsFor(card);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        setError(parseActionError(body, res.status));
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
        <div data-testid="board-card-action-error" className="text-[10px] text-red-400">
          {error}
        </div>
      ) : null}
    </div>
  );
}
