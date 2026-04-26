"use client";

import { useSSE } from "../lib/sse/SSEContext";
import type { ItemState } from "../lib/sse/types";

export type BoardCardProps = {
  itemId: string;
  itemCode?: string;
  title?: string;
  summary?: string;
  showMiniStepper?: boolean;
  actions?: ReadonlyArray<{ name: string; label: string; onClick?: () => void }>;
};

const STATUS_LABELS: Record<string, string> = {
  running: "Running",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
  pending: "Pending",
  todo: "Todo",
};

function labelFor(status: string | undefined): string {
  if (!status) return "—";
  return STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

const STEP_LABELS = ["Arch", "Plan", "Exec", "Review"] as const;

export function BoardCard({
  itemId,
  itemCode,
  title,
  summary,
  showMiniStepper = false,
  actions,
}: BoardCardProps) {
  const { itemState } = useSSE();
  const state: ItemState = itemState[itemId] ?? { id: itemId };

  const status = state.status;
  const attention = state.attention === true;
  const step = state.step;

  return (
    <article
      data-testid="board-card"
      data-item-id={itemId}
      className="border border-[var(--color-border,#333)] p-3 font-mono text-xs"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          {itemCode ? (
            <span data-testid="card-code" className="text-[var(--color-muted,#888)]">
              {itemCode}
            </span>
          ) : null}
          {title ? (
            <span data-testid="card-title" className="font-semibold">
              {title}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {attention ? (
            <span
              data-testid="attention-dot"
              aria-label="Aufmerksamkeit erforderlich"
              className="inline-block w-2 h-2 rounded-full bg-[var(--color-warn,#fa5)]"
            />
          ) : null}
          <span
            data-testid="status-chip"
            data-status={status ?? ""}
            className="px-2 py-0.5 border border-[var(--color-border,#333)]"
          >
            {labelFor(status)}
          </span>
        </div>
      </header>

      {summary ? (
        <p
          data-testid="card-summary"
          className="mt-2 line-clamp-2 text-[var(--color-muted,#888)]"
        >
          {summary}
        </p>
      ) : null}

      {showMiniStepper ? (
        <ol
          data-testid="mini-stepper"
          aria-label="Implementation steps"
          className="mt-2 flex gap-1"
        >
          {STEP_LABELS.map((label, idx) => {
            const segNum = idx + 1;
            const active = step === segNum;
            return (
              <li
                key={label}
                data-testid="mini-stepper-segment"
                data-segment={String(segNum)}
                data-active={active ? "true" : "false"}
                className={
                  active
                    ? "px-2 border border-[var(--color-accent,#5fa)] text-[var(--color-accent,#5fa)]"
                    : "px-2 border border-[var(--color-border,#333)] text-[var(--color-muted,#888)]"
                }
              >
                {label}
              </li>
            );
          })}
        </ol>
      ) : null}

      {actions && actions.length > 0 ? (
        <div data-testid="card-actions" className="mt-2 flex gap-2">
          {actions.map((a) => (
            <button
              key={a.name}
              type="button"
              data-testid={`card-action-${a.name}`}
              onClick={a.onClick}
              className="px-2 py-0.5 border border-[var(--color-border,#333)]"
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export default BoardCard;
