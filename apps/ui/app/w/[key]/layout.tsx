import { fetchWorkspacesResult } from "@/lib/api";
import { WorkspaceProvider } from "@/lib/context/WorkspaceContext";
import { Topbar } from "@/components/Topbar";
import { UnknownWorkspaceGuard } from "@/components/UnknownWorkspace";
import { SSEConnectionManager } from "@/app/lib/sse/SSEContext";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  /**
   * Parallel slot for the intercepting `@modal/(.)items/[id]` route.
   * `default.tsx` in the slot returns null when no overlay is active.
   */
  modal: React.ReactNode;
  params: Promise<{ key: string }>;
}

export default async function WorkspaceLayout({
  children,
  modal,
  params,
}: WorkspaceLayoutProps) {
  const { key } = await params;
  const { workspaces, error } = await fetchWorkspacesResult();
  return (
    <div data-testid="workspace-layout">
      <WorkspaceProvider
        workspaces={workspaces}
        currentKey={key}
        fetchError={error}
      >
        <SSEConnectionManager workspaceKey={key}>
          <Topbar />
          <UnknownWorkspaceGuard>{children}</UnknownWorkspaceGuard>
          {modal}
        </SSEConnectionManager>
      </WorkspaceProvider>
    </div>
  );
}
