"use client";

import { useEffect } from "react";
import {
  DESIGN_PREP_STAGES,
  DESIGN_PREP_STAGE_LABELS,
  IMPLEMENTATION_STAGES,
  IMPLEMENTATION_STAGE_LABELS,
  type BoardCardDTO,
} from "../lib/types";
import { MiniStepper } from "./MiniStepper";
import { BoardCardActions } from "./BoardCardActions";
import { ItemChat } from "./ItemChat";
import { ItemMessages } from "./ItemMessages";

interface BoardItemModalProps {
  card: BoardCardDTO;
  workspaceKey: string;
  onClose: () => void;
}

export function BoardItemModal({ card, workspaceKey, onClose }: BoardItemModalProps) {
  // ESC closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock the underlying board scroll.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const fullPageHref = `/w/${encodeURIComponent(workspaceKey)}/items/${encodeURIComponent(card.id)}`;

  return (
    <div
      data-testid="board-item-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={card.title || "Item detail"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/70 backdrop-blur-sm overflow-y-auto"
    >
      <div
        data-testid="board-item-modal-dialog"
        className="relative w-full max-w-3xl bg-zinc-950 border border-zinc-800 text-zinc-100 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-2 p-4 border-b border-zinc-800">
          <div className="flex flex-col gap-1 min-w-0">
            {card.itemCode ? (
              <span className="text-xs text-zinc-400 font-mono">{card.itemCode}</span>
            ) : null}
            <h2 className="text-lg font-semibold break-words">{card.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="px-2 py-0.5 text-sm border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3">
          {card.summary ? (
            <p className="text-sm text-zinc-300">{card.summary}</p>
          ) : null}

          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-zinc-500">Column</dt>
            <dd className="text-zinc-200 font-mono">{card.column}</dd>
            <dt className="text-zinc-500">Phase</dt>
            <dd className="text-zinc-200 font-mono">{card.phase_status ?? "—"}</dd>
            <dt className="text-zinc-500">Stage</dt>
            <dd className="text-zinc-200 font-mono">{card.current_stage ?? "—"}</dd>
            <dt className="text-zinc-500">Item ID</dt>
            <dd className="text-zinc-400 font-mono break-all">{card.id}</dd>
          </dl>

          {card.column === "implementation" ? (
            <div>
              <div className="text-xs text-zinc-500 mb-1">Implementation</div>
              <MiniStepper
                stage={card.current_stage}
                stages={IMPLEMENTATION_STAGES}
                labels={IMPLEMENTATION_STAGE_LABELS}
                ariaLabel="Implementation progress"
              />
            </div>
          ) : null}
          {card.column === "frontend" ? (
            <div>
              <div className="text-xs text-zinc-500 mb-1">Design prep</div>
              <MiniStepper
                stage={card.current_stage}
                stages={DESIGN_PREP_STAGES}
                labels={DESIGN_PREP_STAGE_LABELS}
                ariaLabel="Design-prep progress"
              />
            </div>
          ) : null}

          <BoardCardActions card={card} />

          <div className="pt-3 border-t border-zinc-800">
            <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
              Conversation
            </h3>
            <ItemChat itemId={card.id} />
          </div>

          <div className="pt-3 border-t border-zinc-800">
            <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
              Messages
            </h3>
            <ItemMessages itemId={card.id} />
          </div>

          <div className="pt-2 border-t border-zinc-800">
            <a
              href={fullPageHref}
              className="text-xs text-zinc-400 hover:text-zinc-200 underline"
            >
              Open full detail page
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BoardItemModal;
