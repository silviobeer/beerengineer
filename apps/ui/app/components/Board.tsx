"use client";

import { useEffect, useState } from "react";

export type BoardItem = {
  id: string;
  title: string;
  status?: string;
};

export type BoardSummary = {
  id: string;
  name?: string;
};

type BoardState =
  | { kind: "loading" }
  | { kind: "error"; reason: string }
  | { kind: "loaded"; board: BoardSummary; items: BoardItem[] };

export type BoardProps = {
  workspaceKey: string;
  engineUrl?: string;
};

function resolveEngineUrl(provided?: string): string {
  if (provided) return provided;
  const fromEnv =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_ENGINE_URL
      : undefined;
  return fromEnv ?? "http://localhost:4100";
}

function extractItems(payload: unknown): BoardItem[] {
  if (Array.isArray(payload)) return payload as BoardItem[];
  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { items?: unknown }).items)
  ) {
    return (payload as { items: BoardItem[] }).items;
  }
  return [];
}

function extractBoard(payload: unknown, fallback: string): BoardSummary {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (obj.board && typeof obj.board === "object") {
      return obj.board as BoardSummary;
    }
    if (typeof obj.id === "string") {
      return obj as BoardSummary;
    }
  }
  return { id: fallback };
}

export function Board({ workspaceKey, engineUrl }: BoardProps) {
  const [state, setState] = useState<BoardState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    const base = resolveEngineUrl(engineUrl);
    const ws = encodeURIComponent(workspaceKey);
    const boardReq = fetch(`${base}/board?workspace=${ws}`);
    const itemsReq = fetch(`${base}/items?workspace=${ws}`);

    Promise.all([boardReq, itemsReq])
      .then(async ([boardRes, itemsRes]) => {
        if (!boardRes.ok) {
          throw new Error(`board:${boardRes.status}`);
        }
        if (!itemsRes.ok) {
          throw new Error(`items:${itemsRes.status}`);
        }
        const [boardJson, itemsJson] = await Promise.all([
          boardRes.json(),
          itemsRes.json(),
        ]);
        if (cancelled) return;
        setState({
          kind: "loaded",
          board: extractBoard(boardJson, workspaceKey),
          items: extractItems(itemsJson),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          reason: err instanceof Error ? err.message : "unknown",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceKey, engineUrl]);

  if (state.kind === "loading") {
    return (
      <div
        data-testid="board-loading"
        role="status"
        aria-live="polite"
        aria-label="Board lädt"
        className="flex items-center justify-center p-6 font-mono text-sm text-[var(--color-muted,#888)]"
      >
        <span aria-hidden="true" className="mr-2">
          ▒
        </span>
        Loading board…
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div
        data-testid="board-error"
        role="alert"
        className="flex flex-col items-start gap-1 p-6 font-mono text-sm text-[var(--color-error,#f55)] border border-[var(--color-error,#f55)]"
      >
        <strong>Could not load the board.</strong>
        <span className="text-xs text-[var(--color-muted,#888)]">
          The engine returned an error or the network is unavailable.
        </span>
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <div
        data-testid="board-empty"
        role="status"
        className="flex flex-col items-center justify-center gap-1 p-10 font-mono text-sm text-[var(--color-muted,#888)] border border-dashed border-[var(--color-border,#333)]"
      >
        <span>No items in this workspace yet.</span>
        <span className="text-xs">Create one from the CLI to get started.</span>
      </div>
    );
  }

  return (
    <div data-testid="board-content" className="p-4">
      <ul role="list" className="grid gap-2">
        {state.items.map((item) => (
          <li
            key={item.id}
            role="listitem"
            data-testid="board-item"
            className="font-mono text-sm border border-[var(--color-border,#333)] p-2"
          >
            <span data-testid="board-item-title">{item.title}</span>
            {item.status ? (
              <span
                data-testid="board-item-status"
                className="ml-2 text-xs text-[var(--color-muted,#888)]"
              >
                {item.status}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Board;
