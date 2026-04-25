"use client";

import { useCallback, useRef } from "react";
import BoardCard from "./BoardCard";
import Topbar from "./Topbar";
import { countAttention, type WorkspaceItem } from "../lib/types";

export type BoardProps = {
  workspaceKey: string;
  items: WorkspaceItem[];
};

export function Board({ workspaceKey, items }: BoardProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLAnchorElement | null>>(new Map());

  const attentionCount = countAttention(items);

  const setCardRef = useCallback((id: string) => {
    return (node: HTMLAnchorElement | null) => {
      if (node) {
        cardRefs.current.set(id, node);
      } else {
        cardRefs.current.delete(id);
      }
    };
  }, []);

  const handleBellClick = useCallback(() => {
    const firstAttention = items.find((it) => it.attentionDot);
    if (!firstAttention) return;
    const node = cardRefs.current.get(firstAttention.id);
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [items]);

  return (
    <div data-testid="board-route" className="flex flex-col h-screen">
      <Topbar
        attentionCount={attentionCount}
        onBellClick={handleBellClick}
        workspaceLabel={`workspace: ${workspaceKey}`}
      />
      <div
        ref={viewportRef}
        data-testid="board-viewport"
        className="flex-1 overflow-auto p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3"
      >
        {items.map((item) => (
          <BoardCard
            key={item.id}
            ref={setCardRef(item.id)}
            item={item}
            workspaceKey={workspaceKey}
          />
        ))}
      </div>
    </div>
  );
}

export default Board;
