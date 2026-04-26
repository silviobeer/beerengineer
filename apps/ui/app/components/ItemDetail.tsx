"use client";

import { useEffect } from "react";
import { useSSE } from "../lib/sse/SSEContext";
import type { ChatEntry, LogEntry } from "../lib/sse/types";
import ConversationPanel, { type ConversationMode } from "./ConversationPanel";
import LiveLogRail from "./LiveLogRail";

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

export type ItemDetailProps = {
  itemId: string;
  itemCode?: string;
  title?: string;
  runId: string | null;
  conversationMode?: ConversationMode;
  initialChat?: ChatEntry[];
  initialLogs?: LogEntry[];
  onSend?: (text: string) => void | Promise<void>;
  onAction?: (actionName: string) => void | Promise<void>;
};

export function ItemDetail({
  itemId,
  itemCode,
  title,
  runId,
  conversationMode = { kind: "inert" },
  initialChat = [],
  initialLogs = [],
  onSend,
  onAction,
}: ItemDetailProps) {
  const { itemState, setRunId } = useSSE();
  const state = itemState[itemId] ?? { id: itemId };

  useEffect(() => {
    setRunId(runId);
  }, [runId, setRunId]);

  return (
    <main data-testid="item-detail" data-item-id={itemId} className="flex flex-col gap-3 p-3">
      <header className="flex items-center justify-between border-b border-[var(--color-border,#333)] pb-2">
        <div className="flex flex-col">
          {itemCode ? (
            <span data-testid="detail-code" className="text-[var(--color-muted,#888)] font-mono text-xs">
              {itemCode}
            </span>
          ) : null}
          {title ? (
            <h1 data-testid="detail-title" className="text-base font-semibold">
              {title}
            </h1>
          ) : null}
        </div>
        <span
          data-testid="status-chip"
          data-status={state.status ?? ""}
          className="px-2 py-0.5 border border-[var(--color-border,#333)] font-mono text-xs"
        >
          {labelFor(state.status)}
        </span>
      </header>

      <ConversationPanel
        runId={runId}
        initialEntries={initialChat}
        mode={conversationMode}
        onSend={onSend}
        onAction={onAction}
      />

      <LiveLogRail runId={runId} initialLogs={initialLogs} />
    </main>
  );
}

export default ItemDetail;
