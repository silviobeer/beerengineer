import type { BoardColumnViewModel } from "@/lib/view-models";
import { BoardCard } from "@/components/board/BoardCard";

export function BoardColumn({ column }: { column: BoardColumnViewModel }) {
  return (
    <section className="board-column">
      <div className="column-head">
        <h3>{column.title}</h3>
        <span className="count">{String(column.count).padStart(2, "0")}</span>
      </div>
      <div className="column-stack">
        {column.cards.map((card) => (
          <BoardCard key={card.itemCode} card={card} />
        ))}
      </div>
    </section>
  );
}
