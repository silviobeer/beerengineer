"use client";

import { useWorkspaceContext } from "@/lib/context/WorkspaceContext";

export function UnknownWorkspaceGuard({ children }: { children: React.ReactNode }) {
  const { isKnownWorkspace, currentKey, workspaces } = useWorkspaceContext();
  if (isKnownWorkspace) return <>{children}</>;
  return (
    <div
      role="alert"
      data-testid="workspace-unknown"
      className="m-3 border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-200"
    >
      <h2 className="text-base font-semibold text-zinc-100">
        Workspace not found
      </h2>
      <p className="mt-1 text-zinc-400">
        No workspace is registered with the key{" "}
        <code className="font-mono text-zinc-200">{currentKey}</code>.
      </p>
      {workspaces.length > 0 ? (
        <p className="mt-1 text-zinc-400">
          Pick a registered workspace from the switcher above.
        </p>
      ) : null}
    </div>
  );
}
