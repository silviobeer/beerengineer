import type { BoardViewModel } from "@/lib/view-models";
import { MonoLabel } from "@/components/primitives/MonoLabel";
import { BoardColumn } from "@/components/board/BoardColumn";
import { BoardFilterBar } from "@/components/board/BoardFilterBar";

export function BoardView({ board }: { board: BoardViewModel }) {
  return (
    <div className="board-surface">
      <div className="board-head">
        <div>
          <MonoLabel>Live board</MonoLabel>
          <h1>{board.heading}</h1>
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
