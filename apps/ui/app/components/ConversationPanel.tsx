"use client";

import { useState } from "react";

export type ConversationRole = "system" | "operator" | "engine";

export type ReviewGateAction = { label: string; value: string };

export type ConversationEntry = {
  id: string;
  role: ConversationRole;
  text: string;
  type?: "message" | "review-gate";
  promptId?: string;
  actions?: ReviewGateAction[];
  answered?: boolean;
};

export type OpenPrompt =
  | { type: "review-gate" | "clarification"; promptId: string }
  | null;

export type PostAnswerArgs = {
  runId: string;
  promptId: string;
  answer: string;
};

export type PostAnswerFn = (args: PostAnswerArgs) => Promise<unknown>;

export type ConversationPanelProps = {
  runId: string;
  entries: ConversationEntry[];
  openPrompt: OpenPrompt;
  postAnswer: PostAnswerFn;
};

const SPEAKER_LABELS: Record<ConversationRole, string> = {
  system: "S:",
  operator: "You:",
  engine: "Beerengineer:",
};

export function ConversationPanel({
  runId,
  entries,
  openPrompt,
  postAnswer,
}: ConversationPanelProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [appendedOperatorBubbles, setAppendedOperatorBubbles] = useState<
    ConversationEntry[]
  >([]);
  const [submitting, setSubmitting] = useState(false);

  const showFreeForm = openPrompt?.type === "clarification";
  const trimmed = draft.trim();
  const sendDisabled = trimmed.length === 0 || submitting;

  const allEntries = [...entries, ...appendedOperatorBubbles];

  async function handleReviewGateClick(
    promptId: string,
    answer: string,
  ): Promise<void> {
    setError(null);
    try {
      await postAnswer({ runId, promptId, answer });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit answer");
    }
  }

  async function handleSend(): Promise<void> {
    if (!openPrompt || openPrompt.type !== "clarification") return;
    if (trimmed.length === 0) return;
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      await postAnswer({
        runId,
        promptId: openPrompt.promptId,
        answer: draft,
      });
      const submittedText = draft;
      setAppendedOperatorBubbles((prev) => [
        ...prev,
        {
          id: `local-${openPrompt.promptId}-${prev.length}`,
          role: "operator",
          text: submittedText,
        },
      ]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit answer");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      data-testid="conversation-panel"
      aria-label="Interactions"
      className="flex flex-col h-full"
    >
      <ol
        data-testid="conversation-list"
        role="list"
        className="flex-1 overflow-auto px-3 py-2 space-y-2"
      >
        {allEntries.map((entry) => (
          <Bubble
            key={entry.id}
            entry={entry}
            onReviewGateClick={handleReviewGateClick}
          />
        ))}
      </ol>

      {showFreeForm ? (
        <form
          data-testid="conversation-form"
          className="flex flex-col gap-2 border-t border-[var(--color-border,#333)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <textarea
            data-testid="conversation-textarea"
            aria-label="Antwort"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full font-mono text-sm bg-transparent border border-[var(--color-border,#333)] p-2"
          />
          <div className="flex justify-end gap-2">
            <button
              type="submit"
              data-testid="conversation-send"
              disabled={sendDisabled}
              className="px-3 py-1 text-xs font-mono uppercase tracking-wider bg-[var(--color-accent,#5fa)] text-black disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
          {error ? (
            <div
              data-testid="conversation-error"
              role="alert"
              className="text-xs text-[var(--color-error,#f55)]"
            >
              {error}
            </div>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

type BubbleProps = {
  entry: ConversationEntry;
  onReviewGateClick: (promptId: string, answer: string) => void;
};

function Bubble({ entry, onReviewGateClick }: BubbleProps) {
  const label = SPEAKER_LABELS[entry.role];
  const isReviewGate =
    entry.role === "engine" && entry.type === "review-gate";
  const actions = isReviewGate ? entry.actions ?? [] : [];
  const answered = entry.answered === true;

  return (
    <li
      role="listitem"
      data-testid="conversation-bubble"
      data-role={entry.role}
      data-entry-id={entry.id}
      className="flex flex-col gap-1 font-mono text-sm"
    >
      <div className="flex gap-2">
        <span
          data-testid="conversation-bubble-label"
          className="font-bold text-[var(--color-accent,#5fa)]"
        >
          {label}
        </span>
        <span
          data-testid="conversation-bubble-text"
          className="flex-1 whitespace-pre-wrap"
        >
          {entry.text}
        </span>
      </div>
      {isReviewGate && actions.length > 0 && !answered ? (
        <div
          data-testid="conversation-review-gate-actions"
          data-prompt-id={entry.promptId}
          className="flex gap-2 pt-1"
        >
          {actions.map((action) => (
            <button
              key={action.value}
              type="button"
              data-testid="conversation-review-gate-button"
              data-action-value={action.value}
              onClick={() => {
                if (entry.promptId) {
                  onReviewGateClick(entry.promptId, action.value);
                }
              }}
              className="px-3 py-1 text-xs font-mono uppercase tracking-wider border border-[var(--color-border,#333)]"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export default ConversationPanel;
