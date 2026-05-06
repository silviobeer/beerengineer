"use client";

import { useEffect, useMemo, useState } from "react";
import type { GitIdentityDefault, GitIdentityValidationError } from "@/lib/setup/types";

interface GitIdentityFormProps {
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  readonly initialIdentity?: Partial<GitIdentityDefault> | null;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly errors?: GitIdentityValidationError[];
  readonly onSubmit: (identity: { displayName: string; email: string }) => Promise<void> | void;
}

function fieldError(errors: GitIdentityValidationError[] | undefined, field: GitIdentityValidationError["field"]): string | null {
  return errors?.find((error) => error.field === field)?.message ?? null;
}

function isLocalPlaceholder(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@local.beerengineer");
}

export function GitIdentityForm({
  title,
  description,
  submitLabel,
  initialIdentity,
  busy = false,
  disabled = false,
  errors = [],
  onSubmit,
}: Readonly<GitIdentityFormProps>) {
  const [displayName, setDisplayName] = useState(initialIdentity?.displayName ?? "");
  const [email, setEmail] = useState(initialIdentity?.email ?? "");

  useEffect(() => {
    setDisplayName(initialIdentity?.displayName ?? "");
    setEmail(initialIdentity?.email ?? "");
  }, [initialIdentity?.displayName, initialIdentity?.email]);

  const localOnly = useMemo(() => isLocalPlaceholder(email), [email]);
  const displayNameError = fieldError(errors, "displayName");
  const emailError = fieldError(errors, "email");

  return (
    <form
      className="space-y-4 border border-zinc-800 bg-zinc-950/40 p-4"
      data-testid="git-identity-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({ displayName, email });
      }}
    >
      <div className="space-y-1">
        <h3 className="font-display text-lg text-zinc-100">{title}</h3>
        <p className="text-sm text-zinc-400">{description}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm text-zinc-300">
          <span>Display name</span>
          <input
            className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-amber-400"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            aria-invalid={displayNameError ? "true" : "false"}
            aria-describedby={displayNameError ? "git-display-name-error" : undefined}
          />
          {displayNameError ? <span id="git-display-name-error" className="block text-xs text-amber-300">{displayNameError}</span> : null}
        </label>
        <label className="space-y-1 text-sm text-zinc-300">
          <span>Email</span>
          <input
            className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none focus:border-amber-400"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={emailError ? "true" : "false"}
            aria-describedby={emailError ? "git-email-error" : undefined}
          />
          {emailError ? <span id="git-email-error" className="block text-xs text-amber-300">{emailError}</span> : null}
        </label>
      </div>
      {localOnly ? (
        <p className="text-sm text-amber-200" data-testid="git-local-only-warning">
          This private placeholder is fine for local checkpoints. Review it before any future publishing flow.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || disabled}
        className="border border-amber-500 bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
      >
        {busy ? "Saving" : submitLabel}
      </button>
    </form>
  );
}
