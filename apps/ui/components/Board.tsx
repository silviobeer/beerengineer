"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BoardCard } from "./BoardCard";
import { BoardItemModal } from "./BoardItemModal";
import { KanbanColumn } from "./KanbanColumn";
import { BOARD_COLUMNS, type BoardCardDTO } from "../lib/types";
import {
  BOARD_MUTATION_CONVERGENCE_WINDOW_MS,
  BOARD_MUTATION_REFRESH_INTERVAL_MS,
  type BoardLauncherMutationSuccess,
} from "@/lib/api";
import { useSSE } from "@/lib/sse/SSEContext";

export interface BoardLauncherRenderContext {
  readonly selectedWorkspaceKey: string | null;
  readonly isWorkspaceSelected: boolean;
  readonly openItemModalFromMutation: (result: BoardLauncherMutationSuccess) => void;
}

const WORKSPACE_SELECTION_REQUIRED_MESSAGE = "Select a workspace before starting new work.";

interface BoardProps {
  readonly items: BoardCardDTO[];
  readonly workspaceKey?: string;
  readonly renderLauncher?: (context: BoardLauncherRenderContext) => ReactNode;
}

export function Board({ items, workspaceKey, renderLauncher }: Readonly<BoardProps>) {
  const { itemState } = useSSE();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingSelectedCard, setPendingSelectedCard] = useState<BoardCardDTO | null>(null);
  const [pendingMutation, setPendingMutation] = useState<{
    itemId: string;
    startedAt: number;
  } | null>(null);
  const [isRefreshing, startTransition] = useTransition();
  const pendingUnknownIdsRef = useRef<Set<string>>(new Set());

  const liveItems = useMemo<BoardCardDTO[]>(() => {
    return items.map((item) => {
      const live = itemState[item.id];
      if (!live) return item;
      const currentStage = live.currentStage ?? item.current_stage;
      return {
        ...item,
        column: live.column ?? item.column,
        phase_status: live.phaseStatus ?? item.phase_status,
        current_stage: currentStage,
        // Pass attention through as-is so BoardCard can clear stale SSR flags.
        liveAttention: live.attention ?? null,
      };
    });
  }, [items, itemState]);

  const isKnownItemId = useCallback((itemId: string) => {
    return items.some((item) => item.id === itemId) || Object.hasOwn(itemState, itemId);
  }, [itemState, items]);

  useEffect(() => {
    if (isRefreshing) return;

    const knownIds = new Set(items.map(item => item.id));
    const unknownIds = Object.keys(itemState).filter(id => !knownIds.has(id));
    if (unknownIds.length === 0) {
      pendingUnknownIdsRef.current.clear();
      return;
    }

    const nextUnknownKey = unknownIds.slice().sort((a, b) => a.localeCompare(b)).join(",");
    const previousUnknownKey = Array.from(pendingUnknownIdsRef.current).sort((a, b) => a.localeCompare(b)).join(",");
    if (nextUnknownKey === previousUnknownKey) return;

    pendingUnknownIdsRef.current = new Set(unknownIds);
    startTransition(() => {
      router.refresh();
    });
  }, [itemState, items, isRefreshing, router]);

  useEffect(() => {
    if (!pendingMutation) return;
    if (!isKnownItemId(pendingMutation.itemId)) return;
    setPendingMutation(null);
    setPendingSelectedCard((current) =>
      current?.id === pendingMutation.itemId ? null : current,
    );
  }, [isKnownItemId, pendingMutation]);

  useEffect(() => {
    if (!pendingMutation || isRefreshing) return;
    if (isKnownItemId(pendingMutation.itemId)) return;

    const elapsedMs = Date.now() - pendingMutation.startedAt;
    if (elapsedMs >= BOARD_MUTATION_CONVERGENCE_WINDOW_MS) {
      setPendingMutation(null);
      return;
    }

    const timer = globalThis.setTimeout(() => {
      startTransition(() => {
        router.refresh();
      });
    }, Math.min(
      BOARD_MUTATION_REFRESH_INTERVAL_MS,
      BOARD_MUTATION_CONVERGENCE_WINDOW_MS - elapsedMs,
    ));

    return () => globalThis.clearTimeout(timer);
  }, [isKnownItemId, isRefreshing, pendingMutation, router, startTransition]);

  const openItemModalFromMutation = useCallback((result: BoardLauncherMutationSuccess) => {
    setSelectedId(result.itemId);
    setPendingSelectedCard({
      id: result.itemId,
      title: "",
      column: "idea",
      summary: null,
      phase_status: result.status,
      hasOpenPrompt: false,
      hasReviewGateWaiting: false,
      hasBlockedRun: false,
      current_stage: null,
      latestRunId: result.runId,
    });
    setPendingMutation({ itemId: result.itemId, startedAt: Date.now() });
    startTransition(() => {
      router.refresh();
    });
  }, [router, startTransition]);

  const onOpen = useCallback((card: BoardCardDTO) => {
    setSelectedId(card.id);
  }, []);
  const onClose = useCallback(() => {
    setSelectedId(null);
    setPendingMutation(null);
    setPendingSelectedCard(null);
  }, []);

  // Re-derive the selected card from the live items map so the modal stays
  // in sync with SSE updates while it is open.
  const selectedCard = useMemo<BoardCardDTO | null>(() => {
    if (!selectedId) return null;
    const liveCard = liveItems.find((it) => it.id === selectedId);
    if (liveCard) return liveCard;
    if (pendingSelectedCard?.id === selectedId) return pendingSelectedCard;
    return null;
  }, [liveItems, pendingSelectedCard, selectedId]);

  const launcherContext = useMemo<BoardLauncherRenderContext>(() => ({
    selectedWorkspaceKey: workspaceKey ?? null,
    isWorkspaceSelected: Boolean(workspaceKey),
    openItemModalFromMutation,
  }), [openItemModalFromMutation, workspaceKey]);

  return (
    <div className="flex flex-col gap-3">
      <section
        data-testid="board-launcher-shell"
        data-selected-workspace={workspaceKey ?? ""}
        data-workspace-selected={workspaceKey ? "true" : "false"}
        className="flex flex-wrap items-start gap-3 px-3 pt-3"
      >
        <div
          data-testid="board-launcher-slot"
          className="flex min-w-0 flex-1 flex-wrap items-start gap-3"
        >
          {renderLauncher?.(launcherContext)}
        </div>
        {!workspaceKey ? (
          <p
            data-testid="board-launcher-gate-message"
            className="w-full border px-3 py-2 text-sm"
            style={{
              borderColor: "var(--color-zinc-700)",
              backgroundColor: "var(--color-zinc-950)",
              color: "var(--color-zinc-300)",
              fontFamily: "var(--font-body, var(--font-sans))",
            }}
          >
            {WORKSPACE_SELECTION_REQUIRED_MESSAGE}
          </p>
        ) : null}
      </section>
      <div
        data-testid="kanban-board-scroll"
        className="w-full overflow-x-auto overflow-y-hidden"
      >
        <div
          data-testid="kanban-board"
          className="grid gap-3 p-3"
          style={{
            gridTemplateColumns: `repeat(${BOARD_COLUMNS.length}, minmax(16rem, 1fr))`,
          }}
        >
          {BOARD_COLUMNS.map((column) => {
            const columnItems = liveItems.filter((item) => item.column === column);
            return (
              <KanbanColumn key={column} column={column}>
                {columnItems.map((item) => (
                  <BoardCard
                    key={item.id}
                    card={item}
                    workspaceKey={workspaceKey}
                    onOpen={onOpen}
                  />
                ))}
              </KanbanColumn>
            );
          })}
        </div>
      </div>
      {selectedCard && workspaceKey ? (
        <BoardItemModal
          card={selectedCard}
          workspaceKey={workspaceKey}
          onClose={onClose}
        />
      ) : null}
    </div>
  );
}
