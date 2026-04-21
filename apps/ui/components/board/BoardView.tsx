import type { BoardViewModel } from "@/lib/view-models";
import { MonoLabel } from "@/components/primitives/MonoLabel";
import { BoardColumn } from "@/components/board/BoardColumn";
import { BoardFilterBar } from "@/components/board/BoardFilterBar";

export function BoardView({ board }: { board: BoardViewModel }) {
  return (
    <div className="board-surface">
      <div className="board-head">
        <div>
          <MonoLabel>Workspace board</MonoLabel>
          <h2>{board.heading}</h2>
          <p>{board.description}</p>
        </div>
      </div>
      <BoardFilterBar filters={board.filters} />
      <div className="board-grid">
        {board.columns.map((column) => (
          <BoardColumn key={column.key} column={column} />
        ))}
      </div>
    </div>
  );
}
