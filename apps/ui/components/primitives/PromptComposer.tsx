"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { answerPrompt } from "@/lib/api";
import { MonoLabel } from "@/components/primitives/MonoLabel";

export type PromptComposerVariant = "compact" | "full";

type Props = {
  runId: string;
  promptId: string;
  prompt: string;
  variant?: PromptComposerVariant;
  /** Optional secondary link e.g. "Open full run". */
  secondaryHref?: string;
  secondaryLabel?: string;
  /** Auto-focus the textarea when mounted (set on the run workspace, off for board cards). */
  autoFocus?: boolean;
  /** Called after a successful submission so the parent can re-render. */
  onAnswered?: () => void;
};

/**
 * Single prompt-answer surface used in every entry point: overlay, run
 * workspace, inbox row. Wraps `answerPrompt` from `lib/api`.
 */
export function PromptComposer({
  runId,
  promptId,
  prompt,
  variant = "compact",
  secondaryHref,
  secondaryLabel,
  autoFocus,
  onAnswered
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaId = useId();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!answer.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await answerPrompt(runId, promptId, answer);
      setAnswer("");
      onAnswered?.();
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send answer");
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      const form = (event.target as HTMLTextAreaElement).form;
      form?.requestSubmit();
    }
  }

  return (
    <form
      className={`prompt-composer prompt-composer-${variant}`}
      onSubmit={onSubmit}
      data-run-id={runId}
      data-prompt-id={promptId}
    >
      <div className="prompt-composer-head">
        <MonoLabel>Engine asks</MonoLabel>
        {secondaryHref ? (
          <Link href={secondaryHref} className="prompt-composer-link">
            {secondaryLabel ?? "Open full run"}
          </Link>
        ) : null}
      </div>
      <pre className="prompt-text">{prompt}</pre>
      <label htmlFor={textareaId} className="visually-hidden">
        Your answer
      </label>
      <textarea
        id={textareaId}
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        placeholder={variant === "compact" ? "Answer now…  (Ctrl+Enter to send)" : "Type your answer here. Ctrl+Enter to send."}
        rows={variant === "compact" ? 2 : 4}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        disabled={submitting}
      />
      <div className="prompt-composer-foot">
        <button
          type="submit"
          className="detail-action primary"
          disabled={submitting || pending || !answer.trim()}
          data-action="prompt-answer"
        >
          {submitting ? "Sending…" : "Answer"}
        </button>
        {error ? (
          <span role="alert" className="prompt-composer-error">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
