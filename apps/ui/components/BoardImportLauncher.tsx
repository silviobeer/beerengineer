"use client";

import type { ComponentProps } from "react";
import { useEffect, useId, useState } from "react";
import { postBoardLauncherMutation } from "@/lib/api";
import type { BoardLauncherRenderContext } from "./Board";

const GENERIC_IMPORT_FAILURE = "Import failed. Check the folder and try again.";

type FormSubmitEvent = Parameters<NonNullable<ComponentProps<"form">["onSubmit"]>>[0];

interface ImportLauncherButtonProps {
  readonly isOpen: boolean;
  readonly isWorkspaceSelected: boolean;
  readonly isSubmitting: boolean;
  readonly onToggle: () => void;
}

interface ImportLauncherPanelProps {
  readonly inputId: string;
  readonly path: string;
  readonly errorMessage: string | null;
  readonly isSubmitting: boolean;
  readonly onSubmit: (event: FormSubmitEvent) => void;
  readonly onPathChange: (value: string) => void;
}

interface BoardImportLauncherState {
  readonly isOpen: boolean;
  readonly path: string;
  readonly errorMessage: string | null;
  readonly isSubmitting: boolean;
  readonly toggleOpen: () => void;
  readonly submit: (event: FormSubmitEvent) => void;
  readonly updatePath: (value: string) => void;
}

function ImportLauncherButton({
  isOpen,
  isWorkspaceSelected,
  isSubmitting,
  onToggle,
}: Readonly<ImportLauncherButtonProps>) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isWorkspaceSelected === false || isSubmitting}
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
  );
}

function ImportLauncherPanel({
  inputId,
  path,
  errorMessage,
  isSubmitting,
  onSubmit,
  onPathChange,
}: Readonly<ImportLauncherPanelProps>) {
  return (
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
          onChange={(event) => onPathChange(event.target.value)}
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
  );
}

function useBoardImportLauncherState(
  selectedWorkspaceKey: string | null,
  openItemModalFromMutation: BoardLauncherRenderContext["openItemModalFromMutation"],
): BoardImportLauncherState {
  const [isOpen, setIsOpen] = useState(false);
  const [path, setPath] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (selectedWorkspaceKey !== null) return;

    setIsOpen(false);
    setIsSubmitting(false);
    setErrorMessage(null);
  }, [selectedWorkspaceKey]);

  function updatePath(value: string) {
    setPath(value);
    if (errorMessage) {
      setErrorMessage(null);
    }
  }

  async function submit(event: FormSubmitEvent) {
    event.preventDefault();
    if (isSubmitting || selectedWorkspaceKey === null) return;

    const trimmedPath = path.trim();
    if (trimmedPath.length === 0) {
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

  return {
    isOpen,
    path,
    errorMessage,
    isSubmitting,
    toggleOpen: () => setIsOpen((current) => current === false),
    submit: (event) => void submit(event),
    updatePath,
  };
}

export function BoardImportLauncher({
  selectedWorkspaceKey,
  isWorkspaceSelected,
  openItemModalFromMutation,
}: Readonly<BoardLauncherRenderContext>) {
  const inputId = useId();
  const launcher = useBoardImportLauncherState(
    selectedWorkspaceKey,
    openItemModalFromMutation,
  );

  return (
    <div className="flex min-w-0 flex-1 basis-full flex-col gap-2 md:max-w-xl">
      <div className="flex flex-wrap items-start gap-2">
        <ImportLauncherButton
          isOpen={launcher.isOpen}
          isWorkspaceSelected={isWorkspaceSelected}
          isSubmitting={launcher.isSubmitting}
          onToggle={launcher.toggleOpen}
        />
      </div>
      {launcher.isOpen ? (
        <ImportLauncherPanel
          inputId={inputId}
          path={launcher.path}
          errorMessage={launcher.errorMessage}
          isSubmitting={launcher.isSubmitting}
          onSubmit={launcher.submit}
          onPathChange={launcher.updatePath}
        />
      ) : null}
    </div>
  );
}
