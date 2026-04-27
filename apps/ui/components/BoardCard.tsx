import Link from "next/link";
import type { BoardCardDTO } from "../lib/types";
import {
  DESIGN_PREP_STAGES,
  DESIGN_PREP_STAGE_LABELS,
  IMPLEMENTATION_STAGES,
  IMPLEMENTATION_STAGE_LABELS,
} from "../lib/types";
import { MiniStepper } from "./MiniStepper";
import { BoardCardActions } from "./BoardCardActions";

interface BoardCardProps {
  card: BoardCardDTO;
  workspaceKey?: string;
}

const ATTENTION_GOLD = "rgb(234, 179, 8)";

function hasAttention(card: BoardCardDTO): boolean {
  // A live SSE update is authoritative when present (true OR false).
  if (card.liveAttention === true) return true;
  if (card.liveAttention === false) return false;
  return Boolean(
    card.hasOpenPrompt || card.hasReviewGateWaiting || card.hasBlockedRun
  );
}

function buildHref(card: BoardCardDTO, workspaceKey?: string): string {
  const id = card.id || card.itemCode || "";
  if (workspaceKey) {
    return `/w/${encodeURIComponent(workspaceKey)}/items/${encodeURIComponent(id)}`;
  }
  return `/items/${encodeURIComponent(id)}`;
}

export function BoardCard({ card, workspaceKey }: BoardCardProps) {
  const showAttention = hasAttention(card);
  const href = buildHref(card, workspaceKey);

  return (
    <article
      data-testid="board-card"
      data-card-id={card.id}
      data-column={card.column}
      data-item-code={card.itemCode ?? ""}
      className="border border-zinc-800 bg-zinc-900/60 p-3 pr-6 text-zinc-100 relative overflow-hidden"
    >
      {showAttention ? (
        <span
          data-testid="attention-dot"
          aria-label="Attention required"
          style={{
            display: "inline-block",
            width: "8px",
            height: "8px",
            borderRadius: "9999px",
            backgroundColor: ATTENTION_GOLD,
            position: "absolute",
            top: "8px",
            right: "8px",
          }}
        />
      ) : null}
      <Link
        href={href}
        data-testid="board-card-link"
        className="block text-zinc-100 no-underline"
      >
        {card.itemCode ? (
          <div
            data-testid="board-card-code"
            className="text-xs text-zinc-400"
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              wordBreak: "break-all",
              overflowWrap: "anywhere",
            }}
          >
            {card.itemCode}
          </div>
        ) : null}
        <div
          data-testid="board-card-title"
          className="text-sm break-words"
          style={{ overflowWrap: "anywhere" }}
        >
          {card.title}
        </div>
        {card.summary ? (
          <div
            data-testid="board-card-summary"
            className="text-xs text-zinc-400 mt-1"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {card.summary}
          </div>
        ) : null}
        {card.phase_status ? (
          <span
            data-testid="board-card-status-chip"
            className="inline-flex items-center px-1.5 py-0.5 mt-2 text-[10px] uppercase tracking-wider border border-zinc-700 bg-zinc-800 text-zinc-300"
          >
            {card.phase_status}
          </span>
        ) : null}
        {card.column === "implementation" ? (
          <div className="mt-2">
            <MiniStepper
              stage={card.current_stage}
              stages={IMPLEMENTATION_STAGES}
              labels={IMPLEMENTATION_STAGE_LABELS}
              ariaLabel="Implementation progress"
            />
          </div>
        ) : null}
        {card.column === "frontend" ? (
          <div className="mt-2">
            <MiniStepper
              stage={card.current_stage}
              stages={DESIGN_PREP_STAGES}
              labels={DESIGN_PREP_STAGE_LABELS}
              ariaLabel="Design-prep progress"
            />
          </div>
        ) : null}
      </Link>
      <BoardCardActions card={card} />
    </article>
  );
}
