"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWorkspaceContext } from "@/lib/context/WorkspaceContext";

export function WorkspaceSwitcher() {
  const { workspaces, currentKey, isKnownWorkspace, fetchError } =
    useWorkspaceContext();
  const router = useRouter();

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const newKey = event.target.value;
      if (newKey && newKey !== currentKey) {
        router.push(`/w/${encodeURIComponent(newKey)}`);
      }
    },
    [router, currentKey]
  );

  if (fetchError) {
    return (
      <div
        data-testid="workspace-switcher-error-wrap"
        className="flex items-center gap-2"
      >
        <select
          data-testid="workspace-switcher"
          aria-label="Workspace"
          aria-invalid="true"
          value=""
          onChange={handleChange}
          disabled
          className="border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm text-zinc-100 font-mono min-h-10 max-w-full truncate"
        >
          <option value="" data-testid="workspace-switcher-error">
            workspaces unavailable
          </option>
        </select>
        <span
          role="status"
          data-testid="workspace-switcher-error-text"
          className="text-xs text-zinc-400"
        >
          failed to load workspaces
        </span>
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <select
        data-testid="workspace-switcher"
        aria-label="Workspace"
        value=""
        onChange={handleChange}
        disabled
        className="border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm text-zinc-100 font-mono min-h-10 max-w-full truncate"
      >
        <option value="" data-testid="workspace-switcher-empty">
          no workspaces
        </option>
      </select>
    );
  }

  return (
    <select
      data-testid="workspace-switcher"
      aria-label="Workspace"
      value={currentKey}
      onChange={handleChange}
      className="border border-zinc-800 bg-zinc-900 px-2 py-2 text-sm text-zinc-100 font-mono min-h-10 max-w-full truncate"
    >
      {isKnownWorkspace ? null : (
        <option value={currentKey} disabled>
          {currentKey}
        </option>
      )}
      {workspaces.map((w) => {
        const active = w.key === currentKey;
        return (
          <option
            key={w.key}
            value={w.key}
            data-active={active ? "true" : undefined}
            aria-selected={active}
          >
            {w.name}
          </option>
        );
      })}
    </select>
  );
}
