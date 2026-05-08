"use client";

import { type FormEvent, useEffect, useId, useState } from "react";
import { postBoardLauncherMutation } from "@/lib/api";
import type { BoardLauncherRenderContext } from "./Board";

const GENERIC_IMPORT_FAILURE = "Import failed. Check the folder and try again.";

export function BoardImportLauncher({
  selectedWorkspaceKey,
  isWorkspaceSelected,
  openItemModalFromMutation,
}: Readonly<BoardLauncherRenderContext>) {
  const inputId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [path, setPath] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (selectedWorkspaceKey) return;

    setIsOpen(false);
    setIsSubmitting(false);
    setErrorMessage(null);
  }, [selectedWorkspaceKey]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || !selectedWorkspaceKey) return;

    const trimmedPath = path.trim();
    if (!trimmedPath) {
      setErrorMessage("Folder path is required.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await postBoardLauncherMutation("/api/items/import-prepared", {
      workspaceKey: selectedWorkspaceKey,
      path: trimmedPath,
    });
    setIsSubmitting(false);

    if (result.ok) {
      setIsOpen(false);
      openItemModalFromMutation(result);
      return;
    }

    setErrorMessage(result.message ?? GENERIC_IMPORT_FAILURE);
  }

  return (
    <div className="flex min-w-0 flex-1 basis-full flex-col gap-2 md:max-w-xl">
      <div className="flex flex-wrap items-start gap-2">
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          disabled={!isWorkspaceSelected || isSubmitting}
          aria-expanded={isOpen}
          aria-controls="board-import-launcher-panel"
          className="min-h-10 border px-3 py-2 text-left text-sm font-semibold"
          style={{
            backgroundColor: "var(--color-zinc-900)",
            borderColor: "var(--color-zinc-700)",
            color: "var(--color-zinc-100)",
            fontFamily: "var(--font-display)",
          }}
        >
          Import feature
        </button>
      </div>
      {isOpen ? (
        <form
          id="board-import-launcher-panel"
          onSubmit={onSubmit}
          noValidate
          aria-busy={isSubmitting}
          className="flex min-w-0 flex-col gap-3 border p-3"
          style={{
            backgroundColor: "var(--color-zinc-950)",
            borderColor: "var(--color-zinc-700)",
          }}
        >
          <div className="flex flex-col gap-1">
            <label
              htmlFor={inputId}
              className="text-sm font-semibold"
              style={{
                color: "var(--color-zinc-100)",
                fontFamily: "var(--font-display)",
              }}
            >
              Local folder path
            </label>
            <input
              id={inputId}
              required
              type="text"
              value={path}
              onChange={(event) => {
                setPath(event.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              placeholder="/path/to/prepared-feature"
              className="min-h-10 border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--color-zinc-900)",
                borderColor: errorMessage ? "var(--color-coral)" : "var(--color-zinc-700)",
                color: "var(--color-zinc-100)",
                fontFamily: "var(--font-sans)",
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-10 border px-3 py-2 text-sm font-semibold"
              style={{
                backgroundColor: isSubmitting ? "var(--color-zinc-800)" : "var(--color-petrol)",
                borderColor: isSubmitting ? "var(--color-zinc-700)" : "var(--color-petrol-bright)",
                color: "var(--color-zinc-100)",
                fontFamily: "var(--font-display)",
              }}
            >
              {isSubmitting ? "Importing..." : "Start import"}
            </button>
            {isSubmitting ? (
              <p
                className="text-sm"
                style={{
                  color: "var(--color-zinc-300)",
                  fontFamily: "var(--font-sans)",
                }}
              >
                Processing import request...
              </p>
            ) : null}
          </div>
          {errorMessage ? (
            <p
              role="alert"
              className="text-sm"
              style={{
                color: "var(--color-coral)",
                fontFamily: "var(--font-sans)",
              }}
            >
              {errorMessage}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
