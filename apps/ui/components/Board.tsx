import { BoardCard } from "./BoardCard";
import { KanbanColumn } from "./KanbanColumn";
import { BOARD_COLUMNS, type BoardCardDTO } from "../lib/types";

interface BoardProps {
  items: BoardCardDTO[];
  workspaceKey?: string;
}

export function Board({ items, workspaceKey }: BoardProps) {
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
          const columnItems = items.filter((item) => item.column === column);
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
