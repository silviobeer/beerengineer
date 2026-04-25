"use client";

import { useMemo } from "react";
import { PHASES } from "../lib/types";
import type { Item, Phase } from "../lib/types";
import { Column } from "./Column";
import { useBoardSse } from "../lib/use-board-sse";

interface BoardProps {
  workspaceKey: string;
  initialItems: Item[];
  /**
   * SSE endpoint URL. When omitted, no live subscription is started
   * (useful for tests that drive items prop directly).
   */
  sseUrl?: string | null;
  eventSourceFactory?: (url: string) => EventSource;
}

export function Board({
  workspaceKey,
  initialItems,
  sseUrl,
  eventSourceFactory,
}: BoardProps) {
  const { items } = useBoardSse({
    initialItems,
    url: sseUrl,
    eventSourceFactory,
  });

  const byPhase = useMemo(() => {
    const map: Record<Phase, Item[]> = {
      Idea: [],
      Frontend: [],
      Requirements: [],
      Implementation: [],
      Test: [],
      Merge: [],
    };
    for (const it of items) {
      const bucket = map[it.phase];
      if (bucket) bucket.push(it);
    }
    return map;
  }, [items]);

  return (
    <div
      data-testid="board"
      className="flex gap-3 overflow-x-auto p-3 min-h-screen bg-zinc-950"
    >
      {PHASES.map((phase) => (
        <Column
          key={phase}
          phase={phase}
          items={byPhase[phase]}
          workspaceKey={workspaceKey}
        />
      ))}
    </div>
  );
}
