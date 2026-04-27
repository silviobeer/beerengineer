"use client";

import { useMemo } from "react";
import { BoardCard } from "./BoardCard";
import { KanbanColumn } from "./KanbanColumn";
import { BOARD_COLUMNS, type BoardCardDTO } from "../lib/types";
import { useSSE } from "../app/lib/sse/SSEContext";

interface BoardProps {
  items: BoardCardDTO[];
  workspaceKey?: string;
}

export function Board({ items, workspaceKey }: BoardProps) {
  const { itemState } = useSSE();

  const liveItems = useMemo<BoardCardDTO[]>(() => {
    return items.map((item) => {
      const live = itemState[item.id];
      if (!live) return item;
      return {
        ...item,
        column: live.column ?? item.column,
        phase_status: live.phaseStatus ?? item.phase_status,
        current_stage: live.currentStage ?? item.current_stage,
        // Pass attention through as-is so BoardCard can clear stale SSR flags.
        liveAttention: live.attention ?? null,
      };
    });
  }, [items, itemState]);

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
                />
              ))}
            </KanbanColumn>
          );
        })}
      </div>
    </div>
  );
}
