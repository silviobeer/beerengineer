"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWorkspaceContext } from "@/lib/context/WorkspaceContext";

export function WorkspaceSwitcher() {
  const { workspaces, currentKey, isKnownWorkspace } = useWorkspaceContext();
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

  if (workspaces.length === 0) {
    return (
      <select
        data-testid="workspace-switcher"
        aria-label="Workspace"
        value=""
        onChange={handleChange}
        disabled
        className="border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 font-mono"
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
      className="border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 font-mono"
    >
      {isKnownWorkspace ? null : (
        <option value={currentKey} disabled>
          {currentKey}
        </option>
      )}
      {workspaces.map((w) => (
        <option key={w.key} value={w.key}>
          {w.name}
        </option>
      ))}
    </select>
  );
}
