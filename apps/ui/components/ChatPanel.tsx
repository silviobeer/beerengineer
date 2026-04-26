"use client";

import { useState, type FormEvent } from "react";
import type { ConversationEntry } from "../lib/types";

interface ChatPanelProps {
  activeRunId?: string | null;
  conversation: ConversationEntry[];
}

const SPEAKER_LABELS: Record<string, string> = {
  system: "S:",
  agent: "Beerengineer:",
  user: "You:",
  "review-gate": "Beerengineer:",
};

export function ChatPanel({ activeRunId, conversation }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingAnswer, setPendingAnswer] = useState(false);
  const [pendingMessage, setPendingMessage] = useState(false);

  if (!activeRunId) {
    return (
      <section data-testid="chat-panel" aria-label="Chat panel">
        <p data-testid="chat-no-active-run" className="text-sm text-zinc-400">
          No active run.
        </p>
      </section>
    );
  }

  async function handleAction(promptId: string, action: string) {
    if (pendingAnswer) return;
    setSubmitError(null);
    setPendingAnswer(true);
    try {
      const res = await fetch(`/api/runs/${activeRunId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId, answer: action }),
      });
      if (!res.ok) {
        setSubmitError("Failed to send answer.");
      }
    } catch {
      setSubmitError("Failed to send answer.");
    } finally {
      setPendingAnswer(false);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pendingMessage) return;
    if (draft.trim().length === 0) {
      setValidationError("Please enter a message before sending.");
      return;
    }
    setValidationError(null);
    setSubmitError(null);
    setPendingMessage(true);
    try {
      const res = await fetch(`/api/runs/${activeRunId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: draft }),
      });
      if (res.ok) {
        setDraft("");
      } else {
        setSubmitError("Failed to send message.");
      }
    } catch {
      setSubmitError("Failed to send message.");
    } finally {
      setPendingMessage(false);
    }
  }

  return (
    <section data-testid="chat-panel" aria-label="Chat panel">
      {conversation.length === 0 ? (
        <p data-testid="chat-empty-state" className="text-sm text-zinc-400">
          No messages yet.
        </p>
      ) : (
        <ul data-testid="chat-history" className="space-y-2">
          {conversation.map((entry, index) => (
            <ConversationEntryView
              key={entry.id ?? index}
              entry={entry}
              onAction={handleAction}
              disabled={pendingAnswer}
            />
          ))}
        </ul>
      )}
      <form
        data-testid="chat-form"
        onSubmit={handleSubmit}
        className="mt-3 flex flex-col gap-2 w-full max-w-full"
      >
        <textarea
          data-testid="chat-textarea"
          aria-label="Message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100 w-full max-w-full block min-h-20 resize-y box-border"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            data-testid="chat-send"
            disabled={pendingMessage}
            className="border border-zinc-700 px-4 py-2 text-sm text-zinc-100 disabled:opacity-50 min-h-10"
          >
            Send
          </button>
          {validationError ? (
            <span data-testid="chat-validation" className="text-xs text-amber-400">
              {validationError}
            </span>
          ) : null}
          {submitError ? (
            <span data-testid="chat-error" role="alert" className="text-xs text-red-400">
              {submitError}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

interface ConversationEntryViewProps {
  entry: ConversationEntry;
  onAction: (promptId: string, action: string) => void;
  disabled: boolean;
}

function ConversationEntryView({ entry, onAction, disabled }: ConversationEntryViewProps) {
  const label = SPEAKER_LABELS[entry.type];
  const isReviewGate = entry.type === "review-gate";
  return (
    <li
      data-testid="chat-entry"
      data-entry-type={entry.type}
      className="text-sm text-zinc-100"
    >
      {label ? (
        <span data-testid="chat-entry-label" className="mr-1 font-mono text-zinc-400">
          {label}
        </span>
      ) : null}
      <span data-testid="chat-entry-text">{entry.text}</span>
      {isReviewGate && entry.actions && entry.promptId ? (
        <div data-testid="review-gate-actions" className="mt-1 flex gap-2">
          {entry.actions.map((action) => (
            <button
              key={action}
              type="button"
              data-testid="review-gate-action"
              data-action={action}
              disabled={disabled}
              onClick={() => onAction(entry.promptId as string, action)}
              className="border border-zinc-700 px-2 py-1 text-xs text-zinc-100 disabled:opacity-50"
            >
              {action}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}
