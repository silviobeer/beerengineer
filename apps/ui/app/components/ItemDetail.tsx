"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import Topbar from "./Topbar";
import { countAttention, type WorkspaceItem } from "../lib/types";

export type ItemDetailProps = {
  workspaceKey: string;
  itemId: string;
  items?: WorkspaceItem[];
  item?: WorkspaceItem | null;
};

export function ItemDetail({ workspaceKey, itemId, items, item }: ItemDetailProps) {
  const router = useRouter();
  const attentionCount = countAttention(items);
  const backHref = `/w/${workspaceKey}`;

  const handleBellClick = useCallback(() => {
    router.push(backHref);
  }, [router, backHref]);

  return (
    <div data-testid="item-detail-route" className="flex flex-col h-screen">
      <Topbar
        attentionCount={attentionCount}
        onBellClick={handleBellClick}
        backHref={backHref}
        backLabel="← Board"
        workspaceLabel={`workspace: ${workspaceKey}`}
      />
      <main data-testid="item-detail-body" className="flex-1 overflow-auto p-3">
        <div data-testid="item-detail-id" className="font-mono text-xs text-[var(--color-muted,#888)]">
          {itemId}
        </div>
        {item ? (
          <h1 className="mt-2 text-lg font-medium">{item.title}</h1>
        ) : null}
      </main>
    </div>
  );
}

export default ItemDetail;
