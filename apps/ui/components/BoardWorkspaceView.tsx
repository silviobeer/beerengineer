"use client";

import { Board } from "@/components/Board";
import { CreateIdeaLauncher } from "@/components/CreateIdeaLauncher";
import type { BoardCardDTO } from "@/lib/types";

interface BoardWorkspaceViewProps {
  readonly items: BoardCardDTO[];
  readonly workspaceKey: string;
}

export function BoardWorkspaceView({ items, workspaceKey }: Readonly<BoardWorkspaceViewProps>) {
  return (
    <Board
      items={items}
      workspaceKey={workspaceKey}
      renderLauncher={(context) => <CreateIdeaLauncher {...context} />}
    />
  );
}
