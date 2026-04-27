"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ConversationAction, ConversationEntry } from "../lib/types";

function formatTimestamp(iso: string | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

interface ChatPanelProps {
  activeRunId?: string | null;
  conversation: ConversationEntry[];
}

const SPEAKER_LABELS: Record<string, string> = {
  system: "System:",
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
  const [answeredPromptIds, setAnsweredPromptIds] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastMessageCountRef = useRef(0);

  useEffect(() => {
    setAnsweredPromptIds([]);
  }, [activeRunId]);

  // Auto-scroll to bottom when a new message arrives, but only when the user
  // is already near the bottom — preserves manual scroll-back to read history.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = conversation.length > lastMessageCountRef.current;
    lastMessageCountRef.current = conversation.length;
    if (!grew) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [conversation]);

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
      } else {
        setAnsweredPromptIds((prev) =>
          prev.includes(promptId) ? prev : [...prev, promptId]
        );
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
        <div
          ref={scrollRef}
          data-testid="chat-scroll"
          className="overflow-y-auto max-h-[60vh] pr-2 border border-zinc-800 bg-zinc-950/40"
        >
          <ul data-testid="chat-history" className="space-y-3 p-3">
            {conversation.map((entry, index) => (
              <ConversationEntryView
                key={entry.id ?? index}
                entry={entry}
                onAction={handleAction}
                disabled={
                  pendingAnswer ||
                  (typeof entry.promptId === "string" &&
                    answeredPromptIds.includes(entry.promptId))
                }
              />
            ))}
          </ul>
        </div>
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

function normalizeActions(
  actions: Array<string | ConversationAction> | undefined
): ConversationAction[] {
  if (!actions) return [];
  return actions.map((action) =>
    typeof action === "string"
      ? { label: action, value: action }
      : action
  );
}

function ConversationEntryView({ entry, onAction, disabled }: ConversationEntryViewProps) {
  const label = SPEAKER_LABELS[entry.type];
  const isReviewGate = entry.type === "review-gate";
  const actions = normalizeActions(entry.actions);
  const timestamp = formatTimestamp(entry.createdAt);
  // Visually separate user messages from agent / system / review-gate by
  // tinting the bubble's left edge. Indent the message body so the speaker
  // and timestamp form a clear header line above it.
  const accent =
    entry.type === "user"
      ? "border-l-2 border-emerald-500/60"
      : entry.type === "system"
      ? "border-l-2 border-zinc-700"
      : entry.type === "review-gate"
      ? "border-l-2 border-amber-500/60"
      : "border-l-2 border-zinc-600";
  return (
    <li
      data-testid="chat-entry"
      data-entry-type={entry.type}
      className={`text-sm text-zinc-100 py-2 pl-3 pr-2 ${accent}`}
    >
      <div
        data-testid="chat-entry-header"
        className="flex items-baseline gap-2 mb-1"
      >
        {timestamp ? (
          <span
            data-testid="chat-entry-time"
            className="font-mono text-[10px] text-zinc-500 tabular-nums"
            title={entry.createdAt}
          >
            {timestamp}
          </span>
        ) : null}
        {label ? (
          <span
            data-testid="chat-entry-label"
            className="font-mono text-xs uppercase tracking-wider text-zinc-400"
          >
            {label}
          </span>
        ) : null}
      </div>
      <div
        data-testid="chat-entry-text"
        className="pl-3 whitespace-pre-wrap break-words leading-relaxed"
      >
        {entry.text}
      </div>
      {isReviewGate && actions.length > 0 && entry.promptId ? (
        <div data-testid="review-gate-actions" className="mt-2 ml-3 flex gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              data-testid="review-gate-action"
              data-action={action.value}
              disabled={disabled}
              onClick={() => onAction(entry.promptId as string, action.value)}
              className="border border-zinc-700 px-2 py-1 text-xs text-zinc-100 disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}
