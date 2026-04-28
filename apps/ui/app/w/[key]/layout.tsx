import { fetchWorkspacesResult } from "@/lib/api";
import { WorkspaceProvider } from "@/lib/context/WorkspaceContext";
import { Topbar } from "@/components/Topbar";
import { UnknownWorkspaceGuard } from "@/components/UnknownWorkspace";
import { SSEConnectionManager } from "@/lib/sse/SSEContext";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  params: Promise<{ key: string }>;
}

export default async function WorkspaceLayout({
  children,
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
        </SSEConnectionManager>
      </WorkspaceProvider>
    </div>
  );
}
