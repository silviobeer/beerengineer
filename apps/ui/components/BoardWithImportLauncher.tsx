"use client";

import { Board } from "@/components/Board";
import { BoardImportLauncher } from "@/components/BoardImportLauncher";
import type { BoardCardDTO } from "@/lib/types";

interface BoardWithImportLauncherProps {
  readonly items: BoardCardDTO[];
  readonly workspaceKey: string;
}

export function BoardWithImportLauncher({
  items,
  workspaceKey,
}: Readonly<BoardWithImportLauncherProps>) {
  return (
    <Board
      items={items}
      workspaceKey={workspaceKey}
      renderLauncher={(context) => <BoardImportLauncher {...context} />}
    />
  );
}
