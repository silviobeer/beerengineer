"use client";

import Link from "next/link";
import { forwardRef } from "react";
import type { WorkspaceItem } from "../lib/types";

export type BoardCardProps = {
  item: WorkspaceItem;
  workspaceKey: string;
};

export const BoardCard = forwardRef<HTMLAnchorElement, BoardCardProps>(
  function BoardCard({ item, workspaceKey }, ref) {
    return (
      <Link
        ref={ref}
        href={`/w/${workspaceKey}/items/${item.id}`}
        data-testid="board-card"
        data-item-id={item.id}
        data-attention={item.attentionDot ? "true" : "false"}
        className="block p-3 border border-[var(--color-border,#333)] bg-[var(--color-card,#0c0c0c)] hover:border-[var(--color-accent,#5fa)] no-underline"
      >
        <div className="flex items-center gap-2">
          {item.itemCode ? (
            <span className="font-mono text-[10px] uppercase text-[var(--color-muted,#888)]">
              {item.itemCode}
            </span>
          ) : null}
          {item.attentionDot ? (
            <span
              data-testid="board-card-attention-dot"
              aria-label="Aufmerksamkeit erforderlich"
              className="inline-block w-2 h-2 rounded-full bg-[var(--color-warn,#fa5)]"
            />
          ) : null}
        </div>
        <div className="mt-1 text-sm font-medium">{item.title}</div>
        {item.summary ? (
          <p className="mt-1 text-xs text-[var(--color-muted,#888)] line-clamp-2">
            {item.summary}
          </p>
        ) : null}
      </Link>
    );
  }
);

export default BoardCard;
