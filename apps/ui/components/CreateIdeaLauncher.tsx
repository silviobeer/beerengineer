"use client";

import { useId, useState } from "react";
import { postBoardLauncherMutation } from "@/lib/api";
import type { BoardLauncherRenderContext } from "./Board";

const GENERIC_CREATE_IDEA_FAILURE = "Unable to create the idea right now. Try again.";

function deriveIdeaTitle(idea: string): string {
  const firstNonEmptyLine = idea
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return (firstNonEmptyLine ?? "").slice(0, 80);
}

export function CreateIdeaLauncher({
  selectedWorkspaceKey,
  isWorkspaceSelected,
  openItemModalFromMutation,
}: Readonly<BoardLauncherRenderContext>) {
  const inputId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [ideaText, setIdeaText] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || !selectedWorkspaceKey) return;

    if (ideaText.trim().length === 0) {
      setValidationError("Idea content is required.");
      setSubmitError(null);
      return;
    }

    setValidationError(null);
    setSubmitError(null);
    setIsSubmitting(true);

    const result = await postBoardLauncherMutation("/api/runs", {
      workspaceKey: selectedWorkspaceKey,
      title: deriveIdeaTitle(ideaText),
      description: ideaText,
    });

    setIsSubmitting(false);

    if (result.ok) {
      setIdeaText("");
      setIsOpen(false);
      openItemModalFromMutation(result);
      return;
    }

    setSubmitError(result.message ?? GENERIC_CREATE_IDEA_FAILURE);
  }

  return (
    <section
      data-testid="create-idea-launcher"
      className="flex w-full max-w-3xl flex-col gap-3 border p-3 sm:w-auto sm:min-w-[22rem]"
      style={{
        backgroundColor: "var(--color-zinc-900)",
        borderColor: "var(--color-zinc-700)",
        color: "var(--color-zinc-100)",
      }}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2
            className="text-sm uppercase tracking-[0.16em]"
            style={{ color: "var(--color-zinc-300)", fontFamily: "var(--font-display)" }}
          >
            Create idea
          </h2>
          <p
            className="mt-1 text-sm"
            style={{ color: "var(--color-zinc-400)", fontFamily: "var(--font-body, var(--font-sans))" }}
          >
            Start a new board item from a single idea note.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          disabled={!isWorkspaceSelected || isSubmitting}
          aria-expanded={isOpen ? "true" : "false"}
          aria-controls={inputId}
          className="min-h-10 border px-3 py-2 text-sm font-semibold"
          style={{
            borderColor: "var(--color-amber-500)",
            backgroundColor: isOpen ? "var(--color-amber-500)" : "transparent",
            color: isOpen ? "var(--color-zinc-950)" : "var(--color-amber-300)",
            fontFamily: "var(--font-display)",
          }}
        >
          Create idea
        </button>
      </div>

      {isOpen ? (
        <form noValidate className="flex w-full flex-col gap-3" onSubmit={(event) => void handleSubmit(event)}>
          <div className="flex w-full flex-col gap-2">
            <label
              htmlFor={inputId}
              className="text-xs uppercase tracking-[0.16em]"
              style={{ color: "var(--color-zinc-300)", fontFamily: "var(--font-display)" }}
            >
              Idea content
            </label>
            <textarea
              id={inputId}
              required
              rows={6}
              value={ideaText}
              onChange={(event) => {
                setIdeaText(event.target.value);
                if (validationError) setValidationError(null);
                if (submitError) setSubmitError(null);
              }}
              aria-multiline="true"
              aria-invalid={validationError ? "true" : "false"}
              disabled={isSubmitting}
              className="w-full border px-3 py-2 text-sm"
              style={{
                borderColor: validationError ? "var(--color-coral)" : "var(--color-zinc-700)",
                backgroundColor: "var(--color-zinc-950)",
                color: "var(--color-zinc-100)",
                fontFamily: "var(--font-body, var(--font-sans))",
              }}
            />
            {validationError ? (
              <p
                data-testid="create-idea-validation"
                className="text-sm"
                style={{ color: "var(--color-coral)" }}
              >
                {validationError}
              </p>
            ) : null}
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-10 w-full border px-3 py-2 text-sm font-semibold sm:w-auto"
              style={{
                borderColor: "var(--color-amber-500)",
                backgroundColor: "var(--color-amber-500)",
                color: "var(--color-zinc-950)",
                fontFamily: "var(--font-display)",
              }}
            >
              {isSubmitting ? "Creating idea..." : "Start idea"}
            </button>
            <div
              role="status"
              aria-live="polite"
              className="min-h-5 text-sm"
              style={{ color: "var(--color-zinc-300)" }}
            >
              {isSubmitting ? "Creating idea..." : ""}
            </div>
          </div>

          {submitError ? (
            <p
              data-testid="create-idea-error"
              className="border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--color-coral)",
                backgroundColor: "var(--color-zinc-950)",
                color: "var(--color-zinc-100)",
              }}
            >
              {submitError}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
