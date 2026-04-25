import type { BoardCardDTO } from "../lib/types";
import { MiniStepper } from "./MiniStepper";

interface BoardCardProps {
  card: BoardCardDTO;
}

export function BoardCard({ card }: BoardCardProps) {
  const isImplementation = card.column === "implementation";

  return (
    <article
      data-testid="board-card"
      data-card-id={card.id}
      data-column={card.column}
      className="border border-zinc-800 bg-zinc-900/60 p-3 text-zinc-100"
    >
      {card.itemCode ? (
        <div data-testid="board-card-code" className="font-mono text-xs text-zinc-400">
          {card.itemCode}
        </div>
      ) : null}
      <div data-testid="board-card-title" className="text-sm break-words">
        {card.title}
      </div>
      {isImplementation ? (
        <div className="mt-2">
          <MiniStepper stage={card.current_stage} />
        </div>
      ) : null}
    </article>
  );
}
