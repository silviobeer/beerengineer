export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div data-testid="workspace-layout">{children}</div>;
}
