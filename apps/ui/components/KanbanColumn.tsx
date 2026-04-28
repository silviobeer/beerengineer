import type { ReactNode } from "react";
import {
  BOARD_COLUMN_LABELS,
  type BoardColumn,
} from "../lib/types";

interface KanbanColumnProps {
  readonly column: BoardColumn;
  readonly children?: ReactNode;
}

export function KanbanColumn({ column, children }: Readonly<KanbanColumnProps>) {
  const label = BOARD_COLUMN_LABELS[column];
  return (
    <section
      data-testid="kanban-column"
      data-column={column}
      aria-label={label}
      className="flex flex-col min-w-[16rem] border border-zinc-800 bg-zinc-950"
    >
      <header
        data-testid="kanban-column-header"
        className="px-3 py-2 border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-300 font-mono"
      >
        {label}
      </header>
      <div
        data-testid="kanban-column-body"
        className="flex flex-col gap-2 p-2 min-h-[4rem]"
      >
        {children}
      </div>
    </section>
  );
}
