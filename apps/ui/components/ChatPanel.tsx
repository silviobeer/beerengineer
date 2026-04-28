"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
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

function extractReviewUrls(text: string): string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s)]+/g), (match) => match[0]);
}

function reviewHref(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/runs/")) {
      return `/api${parsed.pathname}`;
    }
  } catch {
    // keep original href
  }
  return url;
}

interface ChatPanelProps {
  readonly activeRunId?: string | null;
  readonly conversation: ConversationEntry[];
  readonly onConversationSync?: (conversation: {
    runId: string;
    updatedAt: string;
    entries: Array<{
      id: string;
      runId: string;
      stageKey: string | null;
      kind: "system" | "message" | "question" | "answer";
      actor: "system" | "agent" | "user";
      text: string;
      createdAt: string;
      promptId?: string;
      answerTo?: string;
      actions?: Array<{ label: string; value: string }>;
    }>;
    openPrompt: {
      promptId: string;
      runId: string;
      stageKey: string | null;
      text: string;
      createdAt: string;
      actions?: Array<{ label: string; value: string }>;
    } | null;
  }) => void;
}

const SPEAKER_LABELS: Record<string, string> = {
  system: "System:",
  agent: "Beerengineer:",
  user: "You:",
  "review-gate": "Beerengineer:",
};

export function ChatPanel({
  activeRunId,
  conversation,
  onConversationSync,
}: Readonly<ChatPanelProps>) {
  const [draft, setDraft] = useState("");
  const [reviewDraft, setReviewDraft] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [reviewValidationError, setReviewValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingAnswer, setPendingAnswer] = useState(false);
  const [pendingMessage, setPendingMessage] = useState(false);
  const [answeredPromptIds, setAnsweredPromptIds] = useState<string[]>([]);
  const [selectedReviewUrl, setSelectedReviewUrl] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastMessageCountRef = useRef(0);

  useEffect(() => {
    setAnsweredPromptIds([]);
    setReviewDraft("");
    setReviewValidationError(null);
    setSelectedReviewUrl(null);
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

  const activePrompt = [...conversation]
    .reverse()
    .find(
      (entry) =>
        typeof entry.promptId === "string" &&
        !answeredPromptIds.includes(entry.promptId)
    );
  const activeReviewPrompt = activePrompt?.type === "review-gate" ? activePrompt : null;
  const activeQuestionPrompt = activePrompt && activePrompt.type !== "review-gate" ? activePrompt : null;
  const reviewUrls = activeReviewPrompt ? extractReviewUrls(activeReviewPrompt.text) : [];

  useEffect(() => {
    if (reviewUrls.length === 0) {
      setSelectedReviewUrl(null);
      return;
    }
    setSelectedReviewUrl((prev) => (prev && reviewUrls.includes(prev) ? prev : reviewUrls[0]));
  }, [activeReviewPrompt?.promptId, reviewUrls]);

  if (!activeRunId) {
    return (
      <section data-testid="chat-panel" aria-label="Chat panel">
        <p data-testid="chat-no-active-run" className="text-sm text-zinc-400">
          No active run.
        </p>
      </section>
    );
  }

  async function submitPromptAnswer(promptId: string, answer: string) {
    if (pendingAnswer) return;
    setSubmitError(null);
    setPendingAnswer(true);
    try {
      const res = await fetch(`/api/runs/${activeRunId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId, answer }),
      });
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body && typeof body === "object" && Array.isArray((body as { entries?: unknown }).entries)) {
          onConversationSync?.(body as Parameters<NonNullable<typeof onConversationSync>>[0]);
        }
        setAnsweredPromptIds((prev) =>
          prev.includes(promptId) ? prev : [...prev, promptId]
        );
      } else {
        setSubmitError("Failed to send answer.");
      }
    } catch {
      setSubmitError("Failed to send answer.");
    } finally {
      setPendingAnswer(false);
    }
  }

  async function handleAction(promptId: string, action: string) {
    if (action === "revise:") {
      setReviewValidationError('Add revision feedback, then send "Revise".');
      return;
    }
    await submitPromptAnswer(promptId, action);
  }

  async function handleReviewDecision(kind: "approve" | "revise") {
    const promptId = activeReviewPrompt?.promptId;
    if (!promptId) return;
    setReviewValidationError(null);
    if (kind === "approve") {
      await submitPromptAnswer(promptId, "approve");
      return;
    }
    const trimmed = reviewDraft.trim();
    if (trimmed.length === 0) {
      setReviewValidationError("Add revision feedback before sending.");
      return;
    }
    await submitPromptAnswer(promptId, `revise: ${trimmed}`);
  }

  const handleSubmit = async (e: Parameters<NonNullable<ComponentProps<"form">["onSubmit"]>>[0]) => {
    e.preventDefault();
    if (pendingMessage) return;
    if (draft.trim().length === 0) {
      setValidationError(
        activeQuestionPrompt
          ? "Please enter an answer before sending."
          : "Please enter a message before sending."
      );
      return;
    }
    setValidationError(null);
    setSubmitError(null);
    if (activeQuestionPrompt?.promptId) {
      setPendingMessage(true);
      try {
        const res = await fetch(`/api/runs/${activeRunId}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ promptId: activeQuestionPrompt.promptId, answer: draft.trim() }),
        });
        if (res.ok) {
          const body = await res.json().catch(() => null);
          if (body && typeof body === "object" && Array.isArray((body as { entries?: unknown }).entries)) {
            onConversationSync?.(body as Parameters<NonNullable<typeof onConversationSync>>[0]);
          }
          setAnsweredPromptIds((prev) =>
            prev.includes(activeQuestionPrompt.promptId as string)
              ? prev
              : [...prev, activeQuestionPrompt.promptId as string]
          );
          setDraft("");
        } else {
          setSubmitError("Failed to answer prompt.");
        }
      } catch {
        setSubmitError("Failed to answer prompt.");
      } finally {
        setPendingMessage(false);
      }
      return;
    }

    setPendingMessage(true);
    try {
      const res = await fetch(`/api/runs/${activeRunId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft.trim() }),
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
  };

  return (
    <section data-testid="chat-panel" aria-label="Chat panel">
      {activeReviewPrompt ? (
        <section
          data-testid="chat-review-gate-banner"
          className="mb-3 border border-amber-700 bg-amber-950/30 p-3"
        >
          <div className="font-mono text-[11px] uppercase tracking-wider text-amber-300">
            Review Required
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-100">
            {activeReviewPrompt.text}
          </p>
          <textarea
            data-testid="chat-review-feedback"
            aria-label="Revision feedback"
            value={reviewDraft}
            onChange={(e) => setReviewDraft(e.target.value)}
            placeholder="Describe what should change before the next iteration."
            className="mt-3 min-h-20 w-full max-w-full resize-y border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100 box-border"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="chat-review-approve"
              disabled={pendingAnswer}
              onClick={() => void handleReviewDecision("approve")}
              className="border border-zinc-700 px-3 py-1.5 text-xs uppercase tracking-wider text-zinc-100 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              data-testid="chat-review-revise"
              disabled={pendingAnswer}
              onClick={() => void handleReviewDecision("revise")}
              className="border border-amber-600 bg-amber-500/10 px-3 py-1.5 text-xs uppercase tracking-wider text-amber-200 disabled:opacity-50"
            >
              Revise
            </button>
            {reviewValidationError ? (
              <span data-testid="chat-review-validation" className="text-xs text-amber-300">
                {reviewValidationError}
              </span>
            ) : null}
          </div>
          {reviewUrls.length > 0 ? (
            <div className="mt-3 space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-zinc-400">
                Review Targets
              </div>
              <div className="flex flex-wrap gap-2">
                {reviewUrls.map((url, index) => {
                  const href = reviewHref(url);
                  const active = selectedReviewUrl === url;
                  return (
                    <button
                      key={url}
                      type="button"
                      data-testid="chat-review-target"
                      data-active={active ? "true" : "false"}
                      onClick={() => setSelectedReviewUrl(url)}
                      className={
                        active
                          ? "border border-amber-500 bg-amber-500/15 px-2 py-1 text-[11px] uppercase tracking-wider text-amber-200"
                          : "border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] uppercase tracking-wider text-zinc-300"
                      }
                    >
                      {`Mockup ${index + 1}`}
                    </button>
                  );
                })}
                {selectedReviewUrl ? (
                  <a
                    href={reviewHref(selectedReviewUrl)}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="chat-review-open-link"
                    className="border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] uppercase tracking-wider text-zinc-300 underline"
                  >
                    Open in new tab
                  </a>
                ) : null}
              </div>
              {selectedReviewUrl ? (
                <iframe
                  title="Review target preview"
                  src={reviewHref(selectedReviewUrl)}
                  data-testid="chat-review-iframe"
                  className="h-72 w-full border border-zinc-800 bg-white"
                />
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      {activeQuestionPrompt ? (
        <section
          data-testid="chat-prompt-banner"
          className="mb-3 border border-emerald-700 bg-emerald-950/20 p-3"
        >
          <div className="font-mono text-[11px] uppercase tracking-wider text-emerald-300">
            Input Required
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-100">
            {activeQuestionPrompt.text}
          </p>
        </section>
      ) : null}
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
          aria-label={activeQuestionPrompt ? "Prompt answer" : "Message"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={activeQuestionPrompt ? "Answer the current prompt here." : undefined}
          className="border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100 w-full max-w-full block min-h-20 resize-y box-border"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            data-testid="chat-send"
            disabled={pendingMessage}
            className="border border-zinc-700 px-4 py-2 text-sm text-zinc-100 disabled:opacity-50 min-h-10"
          >
            {activeQuestionPrompt ? "Answer Prompt" : "Send"}
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
  readonly entry: ConversationEntry;
  readonly onAction: (promptId: string, action: string) => void;
  readonly disabled: boolean;
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

function ConversationEntryView({ entry, onAction, disabled }: Readonly<ConversationEntryViewProps>) {
  const label = SPEAKER_LABELS[entry.type];
  const isReviewGate = entry.type === "review-gate";
  const actions = normalizeActions(entry.actions);
  const timestamp = formatTimestamp(entry.createdAt);
  // Visually separate user messages from agent / system / review-gate by
  // tinting the bubble's left edge. Indent the message body so the speaker
  // and timestamp form a clear header line above it.
  let accent = "border-l-2 border-zinc-600";
  if (entry.type === "user") accent = "border-l-2 border-emerald-500/60";
  else if (entry.type === "system") accent = "border-l-2 border-zinc-700";
  else if (entry.type === "review-gate") accent = "border-l-2 border-amber-500/60";
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
