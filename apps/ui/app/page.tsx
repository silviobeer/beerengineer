"use client";

import { useState } from "react";
import { BoardView } from "@/components/board/BoardView";
import { ItemOverlay } from "@/components/overlay/ItemOverlay";
import { AppShell } from "@/components/shell/AppShell";
import { defaultWorkspaceKey, getWorkspaceBoardState } from "@/lib/mock-data";

export default function BoardPage() {
  const [activeWorkspaceKey, setActiveWorkspaceKey] = useState(defaultWorkspaceKey);
  const { shell, board, overlay } = getWorkspaceBoardState(activeWorkspaceKey);

  return (
    <AppShell shell={shell} activeHref="/" onWorkspaceChange={setActiveWorkspaceKey}>
      <div className="canvas">
        <BoardView board={board} />
        <ItemOverlay overlay={overlay} />
      </div>
    </AppShell>
  );
}
