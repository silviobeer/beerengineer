"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useSSE } from "../lib/sse/SSEContext";
import type { ChatEntry } from "../lib/sse/types";

export type ConversationMode =
  | { kind: "inert" }
  | { kind: "clarification"; promptText?: string }
  | {
      kind: "review_gate";
      promptText?: string;
      actions: ReadonlyArray<{ name: string; label: string }>;
    };

export type ConversationPanelProps = {
  runId: string | null;
  initialEntries?: ChatEntry[];
  mode: ConversationMode;
  onSend?: (text: string) => void | Promise<void>;
  onAction?: (actionName: string) => void | Promise<void>;
};

function bubbleLabel(role: string): string {
  if (role === "system" || role === "S") return "S:";
  if (role === "user" || role === "You") return "You:";
  if (role === "assistant" || role === "Beerengineer") return "Beerengineer:";
  return `${role}:`;
}

export function ConversationPanel({
  runId,
  initialEntries = [],
  mode,
  onSend,
  onAction,
}: ConversationPanelProps) {
  const { registerConversationListener } = useSSE();
  const [entries, setEntries] = useState<ChatEntry[]>(initialEntries);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!runId) return;
    return registerConversationListener((entry) => {
      if (entry.runId && runId && entry.runId !== runId) return;
      setEntries((prev) => [...prev, entry]);
      if (entry.role === "user") setDraft("");
    });
  }, [runId, registerConversationListener]);

  if (mode.kind === "inert" || !runId) {
    return (
      <section
        data-testid="conversation-panel"
        aria-label="Conversation"
        className="border border-[var(--color-border,#333)] p-3 font-mono text-xs"
      >
        <p data-testid="conversation-inert" className="text-[var(--color-muted,#888)]">
          No active run — start one to begin a conversation.
        </p>
      </section>
    );
  }

  const handleSend = () => {
    if (!onSend) return;
    void onSend(draft);
  };

  return (
    <section
      data-testid="conversation-panel"
      aria-label="Conversation"
      className="flex flex-col gap-2 border border-[var(--color-border,#333)] p-3 font-mono text-xs"
    >
      <ol data-testid="conversation-list" className="flex flex-col gap-1">
        {entries.map((entry, idx) => (
          <li
            key={entry.id ?? `${idx}-${entry.role}`}
            data-testid="chat-bubble"
            data-role={entry.role}
            className="px-2 py-1 border border-[var(--color-border-soft,#1a1a1a)]"
          >
            <span className="text-[var(--color-muted,#888)]">
              {bubbleLabel(entry.role)}
            </span>{" "}
            <span>{entry.content}</span>
          </li>
        ))}
      </ol>

      {mode.kind === "clarification" ? (
        <div data-testid="clarification-form" className="flex flex-col gap-2">
          {mode.promptText ? (
            <p
              data-testid="conversation-prompt"
              className="text-[var(--color-muted,#888)]"
            >
              {mode.promptText}
            </p>
          ) : null}
          <textarea
            data-testid="conversation-input"
            aria-label="Antwort"
            value={draft}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
            className="border border-[var(--color-border,#333)] bg-transparent p-1"
          />
          <button
            type="button"
            data-testid="conversation-send"
            aria-label="Send"
            onClick={handleSend}
            className="self-end px-3 py-1 border border-[var(--color-border,#333)]"
          >
            Send
          </button>
        </div>
      ) : null}

      {mode.kind === "review_gate" ? (
        <div data-testid="review-gate-actions" className="flex gap-2">
          {mode.promptText ? (
            <p
              data-testid="conversation-prompt"
              className="text-[var(--color-muted,#888)] mr-auto"
            >
              {mode.promptText}
            </p>
          ) : null}
          {mode.actions.map((a) => (
            <button
              key={a.name}
              type="button"
              data-testid={`gate-action-${a.name}`}
              onClick={() => onAction?.(a.name)}
              className="px-3 py-1 border border-[var(--color-border,#333)]"
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default ConversationPanel;
