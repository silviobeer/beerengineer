import type { BoardCardViewModel } from "@/lib/view-models";
import { AttentionIndicator } from "@/components/board/AttentionIndicator";
import { BoardCardModeIcon } from "@/components/board/BoardCardModeIcon";

export function BoardCard({ card }: { card: BoardCardViewModel }) {
  return (
    <article className={card.selected ? "board-card selected" : "board-card"}>
      <div className="board-card-top">
        <span className="code">{card.itemCode}</span>
        <BoardCardModeIcon mode={card.mode} />
      </div>
      <h4>{card.title}</h4>
      <p>{card.summary}</p>
      <div className="item-signals">
        <AttentionIndicator attention={card.attention} />
        {card.meta.map((entry) => (
          <span key={`${entry.label}-${entry.value}`} className="item-meta">
            {entry.value} {entry.label}
          </span>
        ))}
      </div>
    </article>
  );
}
