import Link from "next/link";
import type { BoardCardViewModel } from "@/lib/view-models";
import { AttentionIndicator } from "@/components/board/AttentionIndicator";
import { BoardCardModeIcon } from "@/components/board/BoardCardModeIcon";
import { MetricPill } from "@/components/primitives/MetricPill";

/**
 * The board card carries a Swiss-editorial restraint and never shows more
 * than six informational elements at once. Tier 2 (stage / open prompts) is
 * only mounted on the selected card; recovery badge stays Tier 2 unless it
 * is the winning attention signal.
 */
export function BoardCard({ card }: { card: BoardCardViewModel }) {
  const className = card.selected ? "board-card selected" : "board-card";
  const recoveryAlsoBadge = card.recoveryStatus && (card.attention === "blocked" || card.attention === "failed");
  const showStage = card.selected && Boolean(card.currentStage);
  const showOpenPrompts = card.selected && (card.openPrompts ?? 0) > 0;
  const runningLabel = card.running ? "Run in progress" : null;

  const inner = (
    <article
      className={className}
      data-running={card.running ? "true" : "false"}
      data-attention={card.attention}
    >
      <div className="board-card-top">
        <span className="code">{card.itemCode}</span>
        {card.running ? (
          <span className="run-pulse" aria-hidden="true">
            <span className="run-pulse-dot" />
          </span>
        ) : null}
        {card.recoveryStatus && !recoveryAlsoBadge ? (
          <span className="recovery-badge" data-status={card.recoveryStatus}>
            {card.recoveryStatus === "blocked" ? "Blocked" : "Failed"}
          </span>
        ) : null}
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
        {showStage ? <span className="item-meta stage-meta">stage · {card.currentStage}</span> : null}
        {showOpenPrompts ? <MetricPill label="prompts" value={String(card.openPrompts)} /> : null}
      </div>
      {runningLabel ? (
        <span className="visually-hidden" role="status">
          {runningLabel}
        </span>
      ) : null}
    </article>
  );

  if (!card.href) return inner;
  return (
    <Link href={card.href} className="board-card-link" aria-current={card.selected ? "true" : undefined}>
      {inner}
    </Link>
  );
}
