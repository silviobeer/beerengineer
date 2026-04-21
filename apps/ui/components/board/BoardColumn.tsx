import type { BoardColumnViewModel } from "@/lib/view-models";
import { BoardCard } from "@/components/board/BoardCard";

export function BoardColumn({ column }: { column: BoardColumnViewModel }) {
  const count = String(column.cards.length).padStart(2, "0");

  return (
    <section className="board-column">
      <div className="column-head">
        <h3>{column.title}</h3>
        <span className="count">{count}</span>
      </div>
      <div className="column-stack">
        {column.cards.map((card) => (
          <BoardCard key={card.itemCode} card={card} />
        ))}
      </div>
    </section>
  );
}
