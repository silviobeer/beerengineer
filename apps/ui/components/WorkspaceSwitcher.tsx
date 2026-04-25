"use client";

import { useRouter } from "next/navigation";
import { useWorkspaceContext } from "@/lib/context/WorkspaceContext";

export function WorkspaceSwitcher() {
  const { workspaces, currentKey } = useWorkspaceContext();
  const router = useRouter();

  return (
    <select
      data-testid="workspace-switcher"
      aria-label="Workspace"
      value={currentKey}
      onChange={(event) => {
        const newKey = event.target.value;
        if (newKey && newKey !== currentKey) {
          router.push(`/w/${newKey}`);
        }
      }}
      className="border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 font-mono"
    >
      {workspaces.find((w) => w.key === currentKey) ? null : (
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
