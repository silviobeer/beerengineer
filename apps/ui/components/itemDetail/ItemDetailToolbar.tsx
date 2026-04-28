"use client";

import { useRef, useState } from "react";
import type { ActionResult, ItemAction } from "@/lib/engine/types";

const BUTTONS: { action: ItemAction; label: string }[] = [
  { action: "start_brainstorm", label: "Start Brainstorm" },
  { action: "start_implementation", label: "Start Implementation" },
  { action: "rerun_design_prep", label: "Rerun Design Prep" },
  { action: "promote_to_requirements", label: "Promote to Requirements" },
  { action: "mark_done", label: "Mark Done" },
];

type Props = {
  readonly allowedActions: string[];
  readonly onAction: (action: ItemAction) => Promise<ActionResult>;
};

export function ItemDetailToolbar({ allowedActions, onAction }: Readonly<Props>): React.ReactElement {
  const allowed = new Set(allowedActions);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function handleClick(action: ItemAction): Promise<void> {
    if (!allowed.has(action)) return;
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await onAction(action);
      if (result.ok) {
        setError(null);
      } else {
        setError(formatError(result.status, result.error));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      setError(`Network error: ${message}`);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div
      aria-label="Item actions"
      className="flex flex-col gap-2 border-b border-zinc-800 px-3 py-3 sm:px-4"
    >
      <div className="flex flex-wrap gap-2 max-w-full">
        {BUTTONS.map(({ action, label }) => {
          const enabled = allowed.has(action);
          return (
            <button
              key={action}
              type="button"
              data-action={action}
              disabled={!enabled}
              aria-disabled={enabled ? undefined : true}
              onClick={() => handleClick(action)}
              className={
                enabled
                  ? "rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-800 min-h-10 max-w-full whitespace-normal text-left"
                  : "rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-500 opacity-50 min-h-10 max-w-full whitespace-normal text-left"
              }
            >
              {label}
            </button>
          );
        })}
      </div>
      {error ? (
        <p
          role="alert"
          data-testid="toolbar-error"
          className="text-xs text-red-400"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function formatError(status: number, error: string): string {
  return `Action failed (${status}): ${error}`;
}

export { BUTTONS as ITEM_TOOLBAR_BUTTONS };
export { ITEM_ACTIONS } from "@/lib/engine/types";
