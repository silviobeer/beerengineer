"use client";

import { useCallback, useMemo, useState } from "react";
import { BoardCard } from "./BoardCard";
import { BoardItemModal } from "./BoardItemModal";
import { KanbanColumn } from "./KanbanColumn";
import { BOARD_COLUMNS, type BoardCardDTO } from "../lib/types";
import { useSSE } from "@/lib/sse/SSEContext";

interface BoardProps {
  items: BoardCardDTO[];
  workspaceKey?: string;
}

export function Board({ items, workspaceKey }: Readonly<BoardProps>) {
  const { itemState } = useSSE();
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const onOpen = useCallback((card: BoardCardDTO) => {
    setSelectedId(card.id);
  }, []);
  const onClose = useCallback(() => {
    setSelectedId(null);
  }, []);

  // Re-derive the selected card from the live items map so the modal stays
  // in sync with SSE updates while it is open.
  const selectedCard = useMemo<BoardCardDTO | null>(() => {
    if (!selectedId) return null;
    return liveItems.find((it) => it.id === selectedId) ?? null;
  }, [liveItems, selectedId]);

  return (
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
