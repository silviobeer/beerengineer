import { fetchWorkspaces } from "@/lib/api";
import { WorkspaceProvider } from "@/lib/context/WorkspaceContext";
import { Topbar } from "@/components/Topbar";
import { UnknownWorkspaceGuard } from "@/components/UnknownWorkspace";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  params: Promise<{ key: string }>;
}

export default async function WorkspaceLayout({
  children,
  params,
}: WorkspaceLayoutProps) {
  const { key } = await params;
  const workspaces = await fetchWorkspaces();
  return (
    <div data-testid="workspace-layout">
      <WorkspaceProvider workspaces={workspaces} currentKey={key}>
        <Topbar />
        <UnknownWorkspaceGuard>{children}</UnknownWorkspaceGuard>
      </WorkspaceProvider>
    </div>
  );
}
